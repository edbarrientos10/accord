import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mcpServer } from '../src/server/mcp';
import { fixture, MemoryRepository } from './helpers';
import { peopleScopes } from '../src/domain/permissions';
import { SupabaseRepository } from '../src/server/repository';
import { POST } from '../src/app/api/v1/commands/[command]/route';
import { GET as attentionGET } from '../src/app/api/v1/attention/route';
import { GET as stateGET } from '../src/app/api/v1/state/route';
import type { Actor, Person } from '../src/domain/types';
const context = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock('../src/server/auth', () => ({
  authenticate: async () => context.actor,
  checkOrigin: () => {},
}));
it('provides People-only REST/MCP parity with scoped attention and retry behavior', async () => {
  const f = fixture();
  f.create();
  const repo = new MemoryRepository(f.state),
    actor = { ...f.agent, scopes: ['people.read', ...peopleScopes], assignments: [] };
  context.actor = actor;
  vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementation((id) => repo.load(id));
  vi.spyOn(SupabaseRepository.prototype, 'replay').mockImplementation((...args) =>
    repo.replay(...args),
  );
  vi.spyOn(SupabaseRepository.prototype, 'commit').mockImplementation((...args) =>
    repo.commit(...args),
  );
  const server = mcpServer(repo, actor),
    client = new Client({ name: 'people-test', version: '1' }),
    [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);
    await client.connect(right);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('accord_person_create');
    expect(tools.tools.map((t) => t.name)).not.toContain('accord_workspace_timezone');
    const payload = { name: 'Jamie', reason: 'Created via MCP' };
    const result = await client.callTool({
      name: 'accord_person_create',
      arguments: { input: payload, idempotencyKey: 'people-interface-create' },
    });
    expect(result.isError).not.toBe(true);
    const p = repo.state.people[0];
    expect(p.name).toBe('Jamie');
    const response = await POST(
      new Request('http://localhost/api/v1/commands/person.update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'people-interface-update',
        },
        body: JSON.stringify({
          entityId: p.id,
          expectedVersion: p.version,
          notes: 'Remember the garden',
          reason: 'Updated via REST',
        }),
      }),
      { params: Promise.resolve({ command: 'person.update' }) },
    );
    expect(response.status).toBe(200);
    const query = await client.callTool({ name: 'accord_query', arguments: {} });
    const state = JSON.parse((query.content as { text: string }[])[0].text);
    expect(state.people[0].notes).toBe('Remember the garden');
    expect(state.workstreams).toEqual([]);
    const commitment = await client.callTool({
      name: 'accord_commitment_create',
      arguments: {
        input: {
          personId: p.id,
          title: 'Feedback',
          direction: 'i_owe',
          coordinatorId: f.human.id,
          promisedDate: '2020-01-01',
          reason: 'Promise',
        },
        idempotencyKey: 'people-interface-commitment',
      },
    });
    expect(commitment.isError).not.toBe(true);
    const httpAttention = await (
      await attentionGET(new Request('http://localhost/api/v1/attention'))
    ).json();
    const mcpAttention = await client.callTool({ name: 'accord_attention', arguments: {} });
    expect(JSON.parse((mcpAttention.content as { text: string }[])[0].text)).toEqual(
      httpAttention.items,
    );
    expect(httpAttention.items).toHaveLength(1);
    context.actor = f.agent;
    const old = await (await stateGET(new Request('http://localhost/api/v1/state'))).json();
    expect(old.state.people).toEqual([]);
    expect(old.state.commitments).toEqual([]);
  } finally {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
  }
});
