import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mcpServer } from '../src/server/mcp';
import { SupabaseRepository } from '../src/server/repository';
import { POST } from '../src/app/api/v1/commands/[command]/route';
import { GET } from '../src/app/api/v1/state/route';
import { fixture, MemoryRepository } from './helpers';
import type { Actor, Workstream } from '../src/domain/types';

const context = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock('../src/server/auth', () => ({
  authenticate: async () => context.actor,
  checkOrigin: () => {},
}));

it('lets a scoped workspace agent create a task with links through MCP', async () => {
  const f = fixture(),
    actor: Actor = { ...f.agent, accessMode: 'workspace', scopes: ['read', 'workstream.create'] },
    repo = new MemoryRepository(f.state),
    server = mcpServer(repo, actor),
    client = new Client({ name: 'links-create-test', version: '1' }),
    [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);
    await client.connect(right);
    const tools = (await client.listTools()).tools;
    expect(tools.some((tool) => tool.name === 'accord_workstream_update')).toBe(false);
    expect(
      tools.find((tool) => tool.name === 'accord_workstream_create')!.inputSchema.properties!.input,
    ).toHaveProperty('properties.links');
    const link = { id: randomUUID(), title: 'Notes', url: 'https://example.com/notes' };
    const result = await client.callTool({
      name: 'accord_workstream_create',
      arguments: {
        input: {
          title: 'Agent task',
          outcome: 'Review notes',
          ownerId: actor.id,
          completionPolicy: 'simple',
          criteria: [],
          nextAction: null,
          links: [link],
          reason: 'Create with resource',
        },
        idempotencyKey: 'mcp-create-linked-task',
      },
    });
    expect(result.isError).not.toBe(true);
    expect(repo.state.workstreams[0].links).toEqual([link]);
  } finally {
    await client.close();
    await server.close();
  }
});

it('exposes link CRUD and queries consistently through REST and the MCP protocol with access checks', async () => {
  const f = fixture(),
    w = f.create(),
    repo = new MemoryRepository(f.state);
  context.actor = f.agent;
  vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementation((id, options) =>
    repo.load(id, options),
  );
  vi.spyOn(SupabaseRepository.prototype, 'replay').mockImplementation((...args) =>
    repo.replay(...args),
  );
  vi.spyOn(SupabaseRepository.prototype, 'commit').mockImplementation((...args) =>
    repo.commit(...args),
  );
  vi.spyOn(SupabaseRepository.prototype, 'recordAttempt').mockResolvedValue();
  const server = mcpServer(repo, f.agent),
    client = new Client({ name: 'links-test', version: '1' }),
    [left, right] = InMemoryTransport.createLinkedPair();
  const rest = (input: unknown, key: string = randomUUID(), name = 'workstream.update') =>
    POST(
      new Request(`http://localhost/api/v1/commands/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
      { params: Promise.resolve({ command: name }) },
    );
  const mcp = (input: unknown, key: string = randomUUID()) =>
    client.callTool({
      name: 'accord_workstream_update',
      arguments: { input, idempotencyKey: key },
    });
  const read = (result: unknown) =>
    JSON.parse((result as { content: { text: string }[] }).content[0].text);
  const patch = (links: Workstream['links']) => ({
    entityId: w.id,
    expectedVersion: repo.state.workstreams[0].version,
    links,
    reason: 'Maintain task links',
  });
  try {
    await server.connect(left);
    await client.connect(right);
    const tools = await client.listTools();
    const update = tools.tools.find((tool) => tool.name === 'accord_workstream_update')!;
    expect(update.inputSchema.properties!.input).toHaveProperty('properties.links');
    expect(update.description).toContain('links');
    const link = {
      id: randomUUID(),
      title: 'Delivery notes',
      url: 'https://example.com/notes',
      note: 'Review this',
    };
    const input = patch([link]);
    expect((await rest(input, 'link-interface-retry')).status).toBe(200);
    const count = repo.state.audit.length;
    const replay = await mcp(input, 'link-interface-retry');
    expect(replay.isError).not.toBe(true);
    expect(read(replay).links).toEqual([link]);
    expect(repo.state.audit).toHaveLength(count);
    expect(
      read(
        await client.callTool({
          name: 'accord_query',
          arguments: { entityId: w.id, includeHistory: false },
        }),
      ).workstreams[0].links,
    ).toEqual([link]);
    expect(
      (await (await GET(new Request('http://localhost/api/v1/state?history=none'))).json()).state
        .workstreams[0].links,
    ).toEqual([link]);
    expect((await rest(input)).status).toBe(409);
    expect((await mcp(input)).isError).toBe(true);
    const edited = { ...link, title: 'Final notes' };
    expect((await mcp(patch([edited]))).isError).not.toBe(true);
    expect(repo.state.workstreams[0].links).toEqual([edited]);
    expect((await rest(patch([]))).status).toBe(200);
    expect(repo.state.workstreams[0].links).toEqual([]);
    const invalid = patch([{ ...link, url: 'javascript:alert(1)' }]);
    expect((await rest(invalid)).status).toBe(400);
    expect((await mcp(invalid)).isError).toBe(true);
    for (const restriction of ['scope', 'assignment'] as const) {
      const scopes = f.agent.scopes,
        assignments = f.agent.assignments;
      if (restriction === 'scope') f.agent.scopes = ['read'];
      else f.agent.assignments = [];
      expect((await rest(patch([link]))).status).toBe(403);
      expect((await mcp(patch([link]))).isError).toBe(true);
      if (restriction === 'assignment') {
        expect(
          read(await client.callTool({ name: 'accord_query', arguments: { entityId: w.id } }))
            .workstreams,
        ).toEqual([]);
        expect(
          (await (await GET(new Request('http://localhost/api/v1/state'))).json()).state
            .workstreams,
        ).toEqual([]);
      }
      f.agent.scopes = scopes;
      f.agent.assignments = assignments;
    }
    context.actor = f.human;
    const created = await rest(
      {
        title: 'Task with links',
        outcome: 'Deliver',
        ownerId: f.human.id,
        completionPolicy: 'simple',
        criteria: [],
        nextAction: null,
        links: [link],
        reason: 'Create linked task',
      },
      randomUUID(),
      'workstream.create',
    );
    expect(created.status).toBe(200);
    expect((await created.json()).result.links).toEqual([link]);
  } finally {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
  }
});
