import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { mcpServer, rejectRawFileReference } from '../src/server/mcp';
import { fixture, MemoryRepository } from './helpers';
import { SupabaseRepository, execute } from '../src/server/repository';
import { POST } from '../src/app/api/v1/commands/[command]/route';
import type { Actor } from '../src/domain/types';
const context = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock('../src/server/auth', () => ({
  authenticate: async () => context.actor,
  checkOrigin: () => {},
}));
describe('web command API and actual stateless MCP transport', () => {
  it('API enforces the same actor, version, approval and evidence rules', async () => {
    const f = fixture(),
      w = f.create(),
      repo = new MemoryRepository(f.state);
    context.actor = f.agent;
    vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementation((id) => repo.load(id));
    vi.spyOn(SupabaseRepository.prototype, 'replay').mockImplementation((a, k, h) =>
      repo.replay(a, k, h),
    );
    vi.spyOn(SupabaseRepository.prototype, 'commit').mockImplementation((...args) =>
      repo.commit(...args),
    );
    const call = async (name: string, input: unknown, key = 'interface-key') =>
      POST(
        new Request(`http://localhost/api/v1/commands/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify(input),
        }),
        { params: Promise.resolve({ command: name }) },
      );
    let response = await call('workstream.update', {
      entityId: w.id,
      expectedVersion: w.version,
      reportedProgress: 'Draft delivered',
      reason: 'API parity',
    });
    expect(response.status).toBe(200);
    const events = repo.state.audit.length;
    response = await call('workstream.update', {
      entityId: w.id,
      expectedVersion: w.version,
      reportedProgress: 'Draft delivered',
      reason: 'API parity',
    });
    expect(response.status).toBe(200);
    expect(repo.state.audit).toHaveLength(events);
    response = await call(
      'workstream.review',
      { entityId: w.id, expectedVersion: 1, reason: 'Stale change' },
      'stale-interface',
    );
    expect(response.status).toBe(409);
    response = await call(
      'workstream.close',
      { entityId: w.id, expectedVersion: 2, evidenceIds: [], reason: 'Unsupported closure' },
      'closure-interface',
    );
    expect(response.status).toBe(409);
    response = await call(
      'identity.create',
      { name: 'Forged approver', kind: 'agent', reason: 'Forged' },
      'forged-interface',
    );
    expect(response.status).toBe(403);
    response = await call(
      'evidence.attach',
      {
        workstreamId: w.id,
        expectedVersion: 2,
        title: 'Forged file',
        description: 'Claim',
        provenance: 'Claim',
        storagePath: 'anything',
        reason: 'Unsafe',
      },
      'file-interface',
    );
    expect(response.status).toBe(400);
    context.actor = f.human;
    response = await call(
      'project.create',
      { name: 'Interface project', reason: 'Create via API' },
      'api-project-create',
    );
    expect(response.status).toBe(200);
    expect(repo.state.projects).toHaveLength(1);
    response = await call(
      'workstream.update',
      {
        entityId: w.id,
        expectedVersion: repo.state.workstreams[0].version,
        projectId: repo.state.projects[0].id,
        priority: 'high',
        reason: 'Plan via API',
      },
      'api-task-planning',
    );
    expect(response.status).toBe(200);
    expect(repo.state.workstreams[0].projectId).toBe(repo.state.projects[0].id);
    vi.restoreAllMocks();
  });
  it('generic client connects over HTTP, queries, proposes, requests approval and cannot self-approve', async () => {
    const f = fixture(),
      w = f.create(),
      repo = new MemoryRepository(f.state);
    let revoked = false;
    const http = createServer(async (req, res) => {
      try {
        if (revoked || req.headers.authorization !== 'Bearer fictional-test-token') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'revoked' }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers))
          if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
        const request = new Request(`http://127.0.0.1${req.url}`, {
          method: req.method,
          headers,
          body: body.length ? body : undefined,
        });
        const server = mcpServer(repo, f.agent),
          transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        await server.close();
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as { port: number }).port,
      client = new Client({ name: 'runtime-independent-test', version: '1.0.0' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: 'Bearer fictional-test-token' } },
        }),
      );
      const tools = await client.listTools();
      expect(tools.tools.some((t) => t.name === 'accord_query')).toBe(true);
      expect(tools.tools.some((t) => t.name === 'accord_grant_approve')).toBe(false);
      const proposalSchema = tools.tools.find((t) => t.name === 'accord_action_propose')!
        .inputSchema.properties!.input as {
        required: string[];
        additionalProperties: boolean;
        properties: Record<string, unknown>;
      };
      expect(proposalSchema.required).toContain('content');
      expect(proposalSchema.required).not.toContain('declaredCost');
      expect(proposalSchema.required).not.toContain('currency');
      expect(proposalSchema.additionalProperties).toBe(false);
      expect(proposalSchema.properties).toHaveProperty('workstreamId');
      const query = await client.callTool({ name: 'accord_query', arguments: {} });
      expect(JSON.stringify(query)).toContain(w.title);
      const input = {
        workstreamId: w.id,
        expectedVersion: 1,
        operation: 'send_email',
        effect: 'Deliver a draft',
        target: 'fictional-recipient',
        content: 'Fictional proposal',
        scope: 'Exact draft only',
        expiresAt: '2099-01-01T00:00:00.000Z',
        reason: 'MCP parity',
      };
      let result = await client.callTool({
        name: 'accord_action_propose',
        arguments: { input, idempotencyKey: 'mcp-propose-key' },
      });
      expect(result.isError).not.toBe(true);
      const action = repo.state.actions[0];
      await client.callTool({
        name: 'accord_action_request_approval',
        arguments: {
          input: {
            entityId: action.id,
            expectedVersion: action.version,
            reason: 'Request owner decision',
          },
          idempotencyKey: 'mcp-approval-key',
        },
      });
      expect(repo.state.actions[0].approvalRequested).toBe(true);
      result = await client.callTool({
        name: 'accord_workstream_close',
        arguments: {
          input: {
            entityId: w.id,
            expectedVersion: repo.state.workstreams[0].version,
            evidenceIds: [],
            reason: 'Cannot claim closure',
          },
          idempotencyKey: 'mcp-closure-key',
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('insufficient_evidence');
      const approved = (await execute(
        repo,
        f.human,
        'grant.approve',
        {
          entityId: action.id,
          expectedVersion: repo.state.actions[0].version,
          granteeId: f.agent.id,
          reason: 'Human accepted exact revision',
        },
        'mcp-human-approval',
      )) as { id: string };
      result = await client.callTool({
        name: 'accord_execution_start',
        arguments: {
          input: {
            actionId: action.id,
            expectedVersion: repo.state.actions[0].version,
            grantId: approved.id,
            reason: 'Reserve authority before external work',
          },
          idempotencyKey: 'mcp-execution-start',
        },
      });
      expect(
        JSON.stringify(
          await client.callTool({ name: 'accord_query', arguments: { entityId: w.id } }),
        ),
      ).toContain('approved');
      expect(tools.tools.some((t) => t.name === 'accord_decision_respond')).toBe(false);
      expect(result.isError).not.toBe(true);
      const execution = repo.state.executions[0];
      result = await client.callTool({
        name: 'accord_execution_report',
        arguments: {
          input: {
            entityId: execution.id,
            expectedVersion: execution.version,
            state: 'succeeded',
            result: 'Controlled provider double returned acceptance',
            externalId: 'fictional-acceptance-1',
            reason: 'Observed external result',
          },
          idempotencyKey: 'mcp-execution-report',
        },
      });
      expect(result.isError).not.toBe(true);
      result = await client.callTool({
        name: 'accord_evidence_attach',
        arguments: {
          input: {
            workstreamId: w.id,
            expectedVersion: repo.state.workstreams[0].version,
            executionId: execution.id,
            criterionIds: [w.criteria[0].id],
            title: 'Fictional acceptance receipt',
            description: 'Controlled provider confirms agreed acceptance',
            provenance: 'Controlled provider fixture',
            reason: 'Establish the criterion',
          },
          idempotencyKey: 'mcp-evidence-attach',
        },
      });
      expect(result.isError).not.toBe(true);
      const evidence = repo.state.evidence[0];
      await execute(
        repo,
        f.human,
        'evidence.verify',
        {
          entityId: evidence.id,
          expectedVersion: evidence.version,
          note: 'Checked the controlled provider receipt',
          reason: 'Human accepted source evidence',
        },
        'mcp-human-verification',
      );
      result = await client.callTool({
        name: 'accord_workstream_close',
        arguments: {
          input: {
            entityId: w.id,
            expectedVersion: repo.state.workstreams[0].version,
            evidenceIds: [evidence.id],
            reason: 'All criteria now established',
          },
          idempotencyKey: 'mcp-verified-closure',
        },
      });
      expect(result.isError).not.toBe(true);
      expect(repo.state.workstreams[0].status).toBe('completed');
      revoked = true;
      await expect(client.callTool({ name: 'accord_query', arguments: {} })).rejects.toThrow();
    } finally {
      await client.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
