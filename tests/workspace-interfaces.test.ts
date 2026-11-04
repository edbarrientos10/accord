import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mcpServer } from '../src/server/mcp';
import { fixture, MemoryRepository } from './helpers';
import { SupabaseRepository } from '../src/server/repository';
import { POST } from '../src/app/api/v1/commands/[command]/route';
import { GET as stateGET } from '../src/app/api/v1/state/route';
import { GET as attentionGET } from '../src/app/api/v1/attention/route';
import { POST as exportPOST } from '../src/app/api/v1/export/route';
import { GET as logsGET } from '../src/app/api/v1/logs/route';
import { workspaceCommandScopes } from '../src/domain/permissions';
import type { Actor } from '../src/domain/types';
const context = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock('../src/server/auth', () => ({
  authenticate: async () => context.actor,
  checkOrigin: () => {},
}));

it('keeps REST/MCP workspace access, management, retries and owner-only boundaries consistent', async () => {
  const f = fixture(),
    task = f.create();
  f.state.workstreams[0].assignedAgentIds = [];
  const actor: Actor = {
    ...f.agent,
    accessMode: 'workspace',
    assignments: [],
    scopes: ['read', ...workspaceCommandScopes, 'workstream.update', 'workstream.manage'],
  };
  context.actor = actor;
  const repo = new MemoryRepository(f.state);
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
  const server = mcpServer(repo, actor),
    client = new Client({ name: 'workspace-test', version: '1' }),
    [left, right] = InMemoryTransport.createLinkedPair();
  const callRest = (name: string, input: unknown, key: string) =>
    POST(
      new Request(`http://localhost/api/v1/commands/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
      { params: Promise.resolve({ command: name }) },
    );
  const readTool = (result: unknown) =>
    JSON.parse((result as { content: { text: string }[] }).content[0].text);
  try {
    await server.connect(left);
    await client.connect(right);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of workspaceCommandScopes)
      expect(tools).toContain('accord_' + name.replaceAll('.', '_'));
    expect(tools).not.toContain('accord_workstream_manage');
    expect(tools).not.toContain('accord_grant_approve');
    const projectInput = { name: 'Empty agent project', reason: 'Plan workspace' };
    const created = await callRest('project.create', projectInput, 'workspace-interface-project');
    expect(created.status).toBe(200);
    const project = (await created.json()).result;
    const state = (
      await (await stateGET(new Request('http://localhost/api/v1/state?history=none'))).json()
    ).state;
    const queried = readTool(
      await client.callTool({ name: 'accord_query', arguments: { includeHistory: false } }),
    );
    expect(queried.workstreams).toEqual(state.workstreams);
    expect(queried.projects).toEqual(state.projects);
    expect(state.projects[0].id).toBe(project.id);
    expect(state.workstreams[0].id).toBe(task.id);
    expect(state.people).toEqual([]);
    const patch = {
      entityId: task.id,
      expectedVersion: task.version,
      ownerId: actor.id,
      projectId: project.id,
      reason: 'Organize',
    };
    const managed = await client.callTool({
      name: 'accord_workstream_update',
      arguments: { input: patch, idempotencyKey: 'workspace-interface-update' },
    });
    expect(managed.isError).not.toBe(true);
    const replayed = await callRest('workstream.update', patch, 'workspace-interface-update');
    expect(replayed.status).toBe(200);
    expect((await replayed.json()).result).toEqual(readTool(managed));
    expect(
      readTool(await client.callTool({ name: 'accord_attention', arguments: {} })).map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual(
      await (
        await attentionGET(new Request('http://localhost/api/v1/attention'))
      )
        .json()
        .then((d) => d.items.map((item: { id: string }) => item.id)),
    );
    expect(
      (await exportPOST(new Request('http://localhost/api/v1/export', { method: 'POST' }))).status,
    ).toBe(403);
    expect((await logsGET(new Request('http://localhost/api/v1/logs'))).status).toBe(403);
    const protectedPatch = {
      entityId: task.id,
      expectedVersion: 2,
      completionPolicy: 'simple',
      reason: 'Weaken safeguards',
    };
    expect(
      (await callRest('workstream.update', protectedPatch, 'workspace-protected-update')).status,
    ).toBe(403);
    expect(
      (
        await client.callTool({
          name: 'accord_workstream_update',
          arguments: { input: protectedPatch, idempotencyKey: 'workspace-protected-mcp' },
        })
      ).isError,
    ).toBe(true);
    actor.accessMode = 'assigned';
    expect(
      (
        await callRest(
          'project.create',
          { name: 'Not authorized', reason: 'Reject' },
          'workspace-assigned-deny',
        )
      ).status,
    ).toBe(403);
  } finally {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
  }
});
