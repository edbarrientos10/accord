import { createHash, randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { Actor } from '../src/domain/types';
import { fixture, MemoryRepository } from './helpers';
import { SupabaseRepository } from '../src/server/repository';
import { makeArchive, validateArchive, prepareRestore } from '../src/server/export';
import { POST as upload } from '../src/app/api/v1/evidence/upload/route';
import { GET as download } from '../src/app/api/v1/evidence/[id]/download/route';
const ctx = vi.hoisted(() => ({
  actor: null as Actor | null,
  files: new Map<string, Uint8Array>(),
}));
vi.mock('../src/server/auth', () => ({
  authenticate: async () => ctx.actor,
  checkOrigin: () => {},
}));
vi.mock('../src/server/supabase', () => ({
  admin: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          ctx.files.set(path, bytes);
          return { error: null };
        },
        download: async (path: string) =>
          ctx.files.has(path)
            ? { data: new Blob([new Uint8Array(ctx.files.get(path)!)]), error: null }
            : { data: null, error: { message: 'Missing' } },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://fictional-storage.invalid/${path}` },
          error: null,
        }),
      }),
    },
  }),
}));
describe('private file evidence and portable recovery', () => {
  it('uploads with server-generated checksum, denies unassigned downloads, and restores evidence integrity', async () => {
    const f = fixture(),
      w = f.create(),
      repo = new MemoryRepository(f.state);
    ctx.actor = f.agent;
    vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementation((id) => repo.load(id));
    vi.spyOn(SupabaseRepository.prototype, 'replay').mockImplementation((a, k, h) =>
      repo.replay(a, k, h),
    );
    vi.spyOn(SupabaseRepository.prototype, 'commit').mockImplementation((...args) =>
      repo.commit(...args),
    );
    const bytes = Buffer.from('Fictional private evidence 🧭'),
      form = new FormData();
    form.set('file', new File([bytes], 'fictional.txt'));
    form.set(
      'metadata',
      JSON.stringify({
        workstreamId: w.id,
        expectedVersion: w.version,
        title: 'Private acceptance',
        description: 'Fictional result',
        provenance: 'Fictional source',
        criterionIds: [w.criteria[0].id],
        reason: 'Attach file',
      }),
    );
    const request = () =>
      new Request('http://localhost/api/v1/evidence/upload', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'file-upload-key' },
        body: form,
      });
    let response = await upload(request());
    expect(response.status).toBe(200);
    const e = repo.state.evidence[0];
    expect(e.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(e.verification).toBe('unverified');
    expect(e.storagePath?.startsWith(`${f.state.workspaceId}/${w.id}/`)).toBe(true);
    const count = repo.state.audit.length;
    response = await upload(request());
    expect(response.status).toBe(200);
    expect(repo.state.evidence).toHaveLength(1);
    expect(repo.state.audit).toHaveLength(count);
    const context = { params: Promise.resolve({ id: e.id }) };
    response = await download(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect((await response.json()).expiresIn).toBe(60);
    ctx.actor = { ...f.agent, assignments: [] };
    response = await download(new Request('http://localhost'), context);
    expect(response.status).toBe(404);
    ctx.actor = { ...f.agent, scopes: [] };
    response = await download(new Request('http://localhost'), context);
    expect(response.status).toBe(403);
    const archive = await makeArchive(repo.state, [w.id]);
    expect(archive.files).toHaveLength(1);
    expect(Buffer.from(archive.files[0].base64, 'base64')).toEqual(bytes);
    expect(JSON.stringify(archive)).not.toContain('token_hash');
    const target = fixture();
    target.state.identities = target.state.identities.filter((i) => i.kind === 'human');
    const restored = prepareRestore(validateArchive(archive), target.state);
    expect(
      restored.evidence[0].storagePath?.startsWith(`${target.state.workspaceId}/${w.id}/`),
    ).toBe(true);
    expect(restored.evidence[0].sha256).toBe(e.sha256);
    expect(restored.audit.length).toBe(archive.state.audit.length + 1);
    const corrupt = structuredClone(archive);
    corrupt.files[0].base64 = Buffer.from('Corrupted bytes').toString('base64');
    expect(() => validateArchive(corrupt)).toThrow(/corrupt/);
    vi.restoreAllMocks();
    ctx.files.clear();
  });
  it('rejects oversize files before accessing storage', async () => {
    const f = fixture(),
      w = f.create();
    ctx.actor = f.agent;
    const form = new FormData();
    form.set('file', new File([new Uint8Array(3145729)], 'too-large.bin'));
    form.set('metadata', JSON.stringify({ workstreamId: w.id }));
    const response = await upload(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'oversize-key' },
        body: form,
      }),
    );
    expect(response.status).toBe(400);
    expect(ctx.files.size).toBe(0);
  });
});
