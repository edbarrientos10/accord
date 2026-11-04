import { describe, it, expect, vi } from 'vitest';
import { fixture } from './helpers';
import { authenticate, checkOrigin } from '../src/server/auth';
import { SupabaseRepository } from '../src/server/repository';
import { hash, tokenHash } from '../src/server/repository';
const env = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock('../src/server/supabase', () => ({ admin: () => env.db }));
describe('credential authentication', () => {
  it('checks token hashes, expiry and revocation on each request', async () => {
    const f = fixture(),
      w = f.create();
    let revoked: string | null = null,
      expires = '2099-01-01T00:00:00.000Z',
      checkedHash = '';
    env.db = {
      from: () => ({
        select: () => ({
          eq: (_key: string, value: string) => {
            checkedHash = value;
            return {
              maybeSingle: async () => ({
                data: {
                  workspace_id: f.state.workspaceId,
                  identity_id: f.agent.id,
                  scopes: ['read'],
                  assignments: [w.id],
                  expires_at: expires,
                  revoked_at: revoked,
                },
              }),
            };
          },
        }),
      }),
    };
    vi.spyOn(SupabaseRepository.prototype, 'load').mockResolvedValue(f.state);
    const attempts = vi.spyOn(SupabaseRepository.prototype, 'recordAttempt').mockResolvedValue();
    const request = new Request('http://localhost/api/v1/commands/workstream.update', {
      headers: { Authorization: 'Bearer accord_fictional-test-token' },
    });
    const actor = await authenticate(request);
    expect(actor.kind).toBe('agent');
    expect(checkedHash).toBe(tokenHash('accord_fictional-test-token'));
    revoked = '2026-10-12T00:00:00.000Z';
    await expect(authenticate(request)).rejects.toThrow(/revoked/);
    expect(attempts.mock.calls[0][1].code).toBe('credential_revoked');
    revoked = null;
    expires = '2000-01-01T00:00:00.000Z';
    await expect(authenticate(request)).rejects.toThrow(/expired/);
    expect(attempts.mock.calls[1][1].code).toBe('credential_expired');
    vi.restoreAllMocks();
  });
  it('requires a real owner identity and verified MFA session', async () => {
    const f = fixture();
    env.db = {
      auth: {
        getUser: async () => ({
          data: {
            user: { id: f.state.identities[0].authUserId, factors: [{ status: 'verified' }] },
          },
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: f.state.workspaceId } }) }),
        }),
      }),
    };
    vi.spyOn(SupabaseRepository.prototype, 'load').mockResolvedValue(f.state);
    const jwt = (aal: string) =>
      `header.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.signature`;
    await expect(
      authenticate(
        new Request('http://localhost', { headers: { Authorization: `Bearer ${jwt('aal1')}` } }),
      ),
    ).rejects.toThrow(/two-factor/);
    const actor = await authenticate(
      new Request('http://localhost', { headers: { Authorization: `Bearer ${jwt('aal2')}` } }),
    );
    expect(actor.id).toBe(f.human.id);
    vi.restoreAllMocks();
  });
  it('rejects browser requests from an unconfigured origin', () => {
    process.env.ACCORD_ORIGIN = 'http://localhost:3000';
    expect(() =>
      checkOrigin(
        new Request('http://localhost', { headers: { Origin: 'https://untrusted.example' } }),
      ),
    ).toThrow(/origin/);
  });
});

it('issues People-only credentials without task assignments and rejects implicit directory access', async () => {
  const { createCredential } = await import('../src/server/credentials');
  const f = fixture();
  vi.spyOn(SupabaseRepository.prototype, 'load').mockResolvedValue(f.state);
  let calls = 0;
  env.db = {
    rpc: async () => {
      calls++;
      return { data: { created: true } };
    },
  };
  try {
    const issued = await createCredential(
      f.human,
      { identityId: f.agent.id, scopes: ['people.read', 'person.create'], assignments: [] },
      'people-token-create',
    );
    expect(issued.token).toMatch(/^accord_/);
    expect(calls).toBe(1);
    await expect(
      createCredential(
        f.human,
        { identityId: f.agent.id, scopes: ['person.create'], assignments: [] },
        'invalid-people-token',
      ),
    ).rejects.toThrow(/people.read/);
    await expect(
      createCredential(
        f.human,
        { identityId: f.agent.id, scopes: ['people.read', 'workstream.update'], assignments: [] },
        'invalid-task-token',
      ),
    ).rejects.toThrow(/assignments/);
    await expect(
      createCredential(
        f.agent,
        { identityId: f.agent.id, scopes: ['people.read'], assignments: [] },
        'forged-people-token',
      ),
    ).rejects.toThrow(/owner/);
  } finally {
    vi.restoreAllMocks();
  }
});

it('issues workspace credentials with explicit management scopes and retains assigned defaults', async () => {
  const { createCredential, listCredentials } = await import('../src/server/credentials');
  const f = fixture(),
    task = f.create();
  f.state.identities.push({ id: crypto.randomUUID(), name: 'Verifier', kind: 'integration' });
  const rpc = vi.fn().mockResolvedValue({ data: { created: true } });
  env.db = {
    rpc,
    from: () => ({
      select: (columns: string) => {
        expect(columns).toContain('access_mode');
        return { eq: async () => ({ data: [{ access_mode: 'workspace' }] }) };
      },
    }),
  };
  vi.spyOn(SupabaseRepository.prototype, 'load').mockResolvedValue(f.state);
  const issue = (patch: object = {}) =>
    createCredential(
      f.human,
      {
        identityId: f.agent.id,
        scopes: ['read'],
        assignments: [],
        accessMode: 'workspace',
        ...patch,
      },
      'workspace-token-test',
    );
  try {
    await issue({ scopes: ['read', 'project.create', 'workstream.manage', 'workstream.update'] });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_access_mode: 'workspace', p_assignments: [] });
    await createCredential(
      f.human,
      { identityId: f.agent.id, scopes: ['read'], assignments: [task.id] },
      'legacy-token-test',
    );
    expect(rpc.mock.calls[1][1].p_access_mode).toBe('assigned');
    expect(rpc.mock.calls[1][1].p_request_hash).toBe(
      hash({
        command: 'credential.create',
        input: { identityId: f.agent.id, scopes: ['read'], assignments: [task.id] },
      }),
    );
    rpc.mockResolvedValueOnce({ data: { created: false } });
    expect((await issue()).token).toBeUndefined();
    expect(await listCredentials(f.human)).toEqual([{ access_mode: 'workspace' }]);
    await expect(issue({ assignments: [task.id] })).rejects.toThrow(/empty record/);
    await expect(issue({ identityId: f.state.identities.at(-1)!.id })).rejects.toThrow(
      /requires an agent/,
    );
    await expect(issue({ accessMode: 'all' })).rejects.toThrow();
    await expect(
      issue({ accessMode: 'assigned', assignments: [task.id], scopes: ['project.create'] }),
    ).rejects.toThrow(/Scope cannot/);
    await expect(issue({ scopes: ['read', 'grant.approve'] })).rejects.toThrow(/Scope cannot/);
    await expect(issue({ scopes: ['person.create'] })).rejects.toThrow(/people.read/);
    await expect(issue({ expiresAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow(/expiry/);
    await expect(issue({ expiresAt: '2099-01-01T00:00:00.000Z' })).rejects.toThrow(/expiry/);
    await expect(
      createCredential(
        f.agent,
        { identityId: f.agent.id, scopes: ['read'], assignments: [], accessMode: 'workspace' },
        'forged-workspace-token',
      ),
    ).rejects.toThrow(/owner/);
  } finally {
    vi.restoreAllMocks();
  }
});

it('authenticates stored workspace access and fails closed on invalid modes and workspace integrations', async () => {
  const f = fixture();
  let mode: string | undefined = 'workspace',
    kind = 'agent';
  env.db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: crypto.randomUUID(),
              workspace_id: f.state.workspaceId,
              identity_id: f.agent.id,
              scopes: ['read'],
              assignments: [],
              access_mode: mode,
              expires_at: '2099-01-01T00:00:00.000Z',
              revoked_at: null,
            },
          }),
        }),
      }),
    }),
  };
  vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementation(async () => ({
    ...f.state,
    identities: f.state.identities.map((i) =>
      i.id === f.agent.id ? { ...i, kind: kind as 'agent' | 'integration' } : i,
    ),
  }));
  const request = new Request('http://localhost/api/v1/state', {
    headers: { Authorization: 'Bearer accord_test' },
  });
  try {
    expect((await authenticate(request)).accessMode).toBe('workspace');
    mode = undefined;
    expect((await authenticate(request)).accessMode).toBe('assigned');
    mode = 'unknown';
    await expect(authenticate(request)).rejects.toThrow(/access mode/);
    mode = 'workspace';
    kind = 'integration';
    await expect(authenticate(request)).rejects.toThrow(/access mode/);
  } finally {
    vi.restoreAllMocks();
  }
});
