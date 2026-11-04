import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fixture, MemoryRepository } from './helpers';
import { mcpServer } from '../src/server/mcp';
import { SupabaseRepository } from '../src/server/repository';
import { recordFailure, logStatus } from '../src/server/attempts';
import { DomainError } from '../src/domain/errors';
import { POST } from '../src/app/api/v1/commands/[command]/route';
import type { Actor } from '../src/domain/types';
const context = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock('../src/server/auth', () => ({
  authenticate: async () => {
    if (!context.actor) throw new DomainError('unauthenticated', 'Invalid credential', 401);
    return context.actor;
  },
  checkOrigin: () => {},
}));
it('records rejected REST commands and separate retries without storing input or secrets', async () => {
  const f = fixture(),
    w = f.create(),
    repo = new MemoryRepository(f.state);
  context.actor = f.agent;
  vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementation((...args) =>
    repo.load(...args),
  );
  vi.spyOn(SupabaseRepository.prototype, 'replay').mockImplementation((...args) =>
    repo.replay(...args),
  );
  vi.spyOn(SupabaseRepository.prototype, 'commit').mockImplementation((...args) =>
    repo.commit(...args),
  );
  vi.spyOn(SupabaseRepository.prototype, 'recordAttempt').mockImplementation((...args) =>
    repo.recordAttempt(...args),
  );
  try {
    const call = (raw: string, key = 'private-retry-value') =>
      POST(
        new Request('http://localhost/api/v1/commands/workstream.update', {
          method: 'POST',
          headers: { 'Idempotency-Key': key, Authorization: 'Bearer private-token' },
          body: raw,
        }),
        { params: Promise.resolve({ command: 'workstream.update' }) },
      );
    const invalid = JSON.stringify({
      entityId: w.id,
      expectedVersion: 0,
      title: 'private secret content',
      password: 'never-store',
      reason: 'sensitive reason',
    });
    for (let i = 0; i < 2; i++) expect((await call(invalid)).status).toBe(400);
    expect(repo.attempts).toHaveLength(2);
    expect(repo.attempts[0].event.id).not.toBe(repo.attempts[1].event.id);
    expect(repo.attempts[0].event.retryReference).toBe(repo.attempts[1].event.retryReference);
    expect(repo.attempts[0].event.validationFields).toContain('expectedVersion');
    expect(JSON.stringify(repo.attempts)).not.toMatch(/private|never-store|sensitive/);
    const isolated = new MemoryRepository(f.state);
    await recordFailure(
      isolated,
      f.human,
      {
        name: 'workstream.update',
        key: 'private-retry-value',
        transport: 'rest',
        started: performance.now(),
      },
      new DomainError('conflict', '', 409),
    );
    expect(isolated.attempts[0].event.retryReference).not.toBe(
      repo.attempts[0].event.retryReference,
    );
    expect(repo.state.audit).toHaveLength(1);
    expect((await call('{malformed')).headers.get('X-Accord-Log-Status')).toBe('recorded');
    context.actor = null;
    expect((await call(invalid)).status).toBe(401);
    expect(repo.attempts).toHaveLength(3);
  } finally {
    vi.restoreAllMocks();
  }
});
it('records MCP SDK validation failures, unavailable scoped tools and domain conflicts exactly once', async () => {
  const f = fixture(),
    w = f.create(),
    repo = new MemoryRepository(f.state),
    server = mcpServer(repo, f.agent),
    client = new Client({ name: 'attempt-test', version: '1' }),
    [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);
    await client.connect(right);
    const bad = await client.callTool({
      name: 'accord_workstream_update',
      arguments: {
        input: { entityId: w.id, expectedVersion: 'private-secret' },
        idempotencyKey: 'private-key',
      },
    });
    expect(bad.isError).toBe(true);
    expect(repo.attempts).toHaveLength(1);
    expect(repo.attempts[0].event.code).toBe('validation');
    const denied = await client.callTool({
      name: 'accord_grant_approve',
      arguments: { input: { secret: 'never-store' }, idempotencyKey: 'private-key' },
    });
    expect(denied.isError).toBe(true);
    expect(repo.attempts).toHaveLength(2);
    expect(repo.attempts[1].event.code).toBe('forbidden');
    await client.callTool({
      name: 'accord_workstream_update',
      arguments: {
        input: { entityId: w.id, expectedVersion: 999, reason: 'private-secret' },
        idempotencyKey: 'private-key',
      },
    });
    expect(repo.attempts).toHaveLength(3);
    expect(repo.attempts[2].event.code).toBe('conflict');
    expect(JSON.stringify(repo.attempts)).not.toMatch(/private-secret|never-store|private-key/);
    await client.callTool({ name: 'accord_query', arguments: { includeHistory: false } });
    expect(repo.attempts).toHaveLength(3);
    repo.load = async () => {
      throw new DomainError('storage_error', 'private provider error', 503);
    };
    const failedRead = await client.callTool({
      name: 'accord_query',
      arguments: { includeHistory: false },
    });
    expect(failedRead.isError).toBe(true);
    expect(repo.attempts).toHaveLength(4);
    expect(repo.attempts[3].event.command).toBe('query');
    expect(repo.attempts[3].event.outcome).toBe('error');
    expect(JSON.stringify(repo.attempts)).not.toContain('private provider error');
  } finally {
    await client.close();
    await server.close();
  }
});
it('records service failures as uncertain outcomes and safely reports an unavailable log sink', async () => {
  const f = fixture(),
    repo = new MemoryRepository(f.state),
    error = new DomainError('storage_error', 'raw credential provider dump', 503);
  await recordFailure(
    repo,
    f.agent,
    { name: 'workstream.update', transport: 'rest', started: performance.now() },
    error,
  );
  expect(repo.attempts[0].event.outcome).toBe('error');
  expect(JSON.stringify(repo.attempts)).not.toContain('raw credential');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  repo.recordAttempt = async () => {
    throw new Error('storage unavailable');
  };
  try {
    await recordFailure(
      repo,
      f.agent,
      { name: 'untrusted token text', transport: 'rest', started: performance.now() },
      error,
    );
    expect(logStatus(error)).toBe('unavailable');
    expect(log.mock.calls[0][0]).not.toMatch(/raw credential|untrusted token/);
  } finally {
    log.mockRestore();
  }
});

it('stops oversized request streams before buffering the entire body', async () => {
  const { body } = await import('../src/server/http');
  let pulls = 0,
    cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(64000).fill(65));
      if (pulls === 100) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('http://localhost', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
  await expect(body(request)).rejects.toMatchObject({ code: 'payload_too_large' });
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThan(10);
});
