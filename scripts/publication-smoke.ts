// Runs only against an explicitly enabled disposable loopback Supabase installation.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SupabaseRepository } from '../src/server/repository';
import { createCredential } from '../src/server/credentials';
import { authenticate } from '../src/server/auth';
import { admin } from '../src/server/supabase';
import { validateArchive } from '../src/server/export';

assert.equal(process.env.ACCORD_DISPOSABLE_SMOKE, 'true');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
assert.equal(new URL(url).hostname, '127.0.0.1');
const origin = process.env.ACCORD_ORIGIN!;
assert.equal(new URL(origin).hostname, '127.0.0.1');
const archivePath = `${process.env.RUNNER_TEMP}/accord-smoke-backup.json`;
const db = admin();
const repo = new SupabaseRepository();
const { data: workspace, error } = await db.from('workspaces').select('id').single();
assert.ifError(error);
assert(workspace);
const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const login = await client.auth.signInWithPassword({
  email: process.env.ACCORD_OWNER_EMAIL!,
  password: process.env.ACCORD_OWNER_PASSWORD!,
});
assert.ifError(login.error);
const token = login.data.session!.access_token;
async function request(path: string, input?: unknown, method = 'POST') {
  const r = await fetch(`${origin}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  assert(r.ok, `${path}: HTTP ${r.status}: ${await r.clone().text()}`);
  return r.json();
}
async function command(name: string, input: unknown) {
  return (await request(`/api/v1/commands/${name}`, input)).result;
}
if (process.argv[2] === 'seed') {
  const denied = await client.auth.signUp({
    email: 'stranger@example.test',
    password: 'Fictional-password-123!',
  });
  assert(denied.error, 'Public signup must be denied');
  const initial = await request('/api/v1/state', undefined, 'GET');
  const owner = initial.state.identities.find((i: { kind: string }) => i.kind === 'human');
  const agent = await command('identity.create', {
    name: 'Fictional smoke agent',
    kind: 'agent',
    reason: 'Release validation',
  });
  const task = await command('workstream.create', {
    title: 'Fictional publication task',
    outcome: 'Review a fictional draft',
    ownerId: owner.id,
    assignedAgentIds: [agent.id],
    criteria: [],
    nextAction: null,
    completionPolicy: 'simple',
    reason: 'Release validation',
  });
  const credential = await request('/api/v1/credentials', {
    identityId: agent.id,
    assignments: [task.id],
    scopes: ['read', 'action.propose', 'action.request_approval'],
  });
  assert(credential.token);
  const mcp = new Client({ name: 'publication-smoke', version: '0.1.0' });
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${credential.token}` } },
      }),
    );
    const query = await mcp.callTool({ name: 'accord_query', arguments: {} });
    assert(JSON.stringify(query).includes('Fictional publication task'));
    const proposal = await mcp.callTool({
      name: 'accord_action_propose',
      arguments: {
        idempotencyKey: randomUUID(),
        input: {
          workstreamId: task.id,
          expectedVersion: task.version,
          operation: 'send_email',
          effect: 'Review draft',
          target: 'fictional@example.test',
          content: 'Fictional draft only',
          scope: 'One fictional draft',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          reason: 'Release validation',
        },
      },
    });
    assert(!proposal.isError, JSON.stringify(proposal));
    let state = await repo.load(workspace.id);
    const action = state.actions[0];
    const approval = await mcp.callTool({
      name: 'accord_action_request_approval',
      arguments: {
        idempotencyKey: randomUUID(),
        input: {
          entityId: action.id,
          expectedVersion: action.version,
          reason: 'Human review required',
        },
      },
    });
    assert(!approval.isError, JSON.stringify(approval));
    state = await repo.load(workspace.id);
    await command('grant.approve', {
      entityId: action.id,
      expectedVersion: state.actions[0].version,
      granteeId: agent.id,
      reason: 'Human accepts fictional draft',
    });
    const current = (await repo.load(workspace.id)).workstreams.find((w) => w.id === task.id)!;
    const form = new FormData();
    form.set('file', new Blob(['Fictional release evidence\n']), 'fictional.txt');
    form.set(
      'metadata',
      JSON.stringify({
        workstreamId: task.id,
        expectedVersion: current.version,
        title: 'Fictional evidence',
        description: 'Synthetic bytes',
        provenance: 'Release smoke test',
        reason: 'Verify private storage',
      }),
    );
    const upload = await fetch(`${origin}/api/v1/evidence/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        'Idempotency-Key': randomUUID(),
      },
      body: form,
    });
    assert(upload.ok, `Evidence upload HTTP ${upload.status}: ${await upload.clone().text()}`);
    const evidence = (await repo.load(workspace.id)).evidence[0];
    const anonymous = await fetch(`${origin}/api/v1/evidence/${evidence.id}/download`);
    assert.equal(anonymous.status, 401);
    const signed = await request(`/api/v1/evidence/${evidence.id}/download`, undefined, 'GET');
    assert.equal(await (await fetch(signed.url)).text(), 'Fictional release evidence\n');
    const revoked = await fetch(`${origin}/api/v1/credentials/${credential.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        'If-Match': String(credential.version ?? 1),
        'Idempotency-Key': randomUUID(),
      },
    });
    assert(revoked.ok, `Revoke HTTP ${revoked.status}`);
    await assert.rejects(() => mcp.callTool({ name: 'accord_query', arguments: {} }));
  } finally {
    await mcp.close();
  }
  execFileSync('npm', ['run', 'backup'], { stdio: 'inherit' });
  const file = (await readdir('backups')).sort().at(-1)!;
  await copyFile(`backups/${file}`, archivePath);
  console.log(
    'PASS: bootstrap/login, signup denial, REST task, MCP proposal/human approval, private evidence and revocation',
  );
} else {
  assert.equal(process.argv[2], 'restore');
  const archive = validateArchive(JSON.parse(await readFile(archivePath, 'utf8')));
  assert.notEqual(
    workspace.id,
    archive.state.workspaceId,
    'Destination must be a separately bootstrapped workspace',
  );
  assert.equal((await repo.load(workspace.id)).workstreams.length, 0);
  execFileSync('npm', ['run', 'restore', '--', archivePath], { stdio: 'inherit' });
  const restored = await repo.load(workspace.id);
  assert.equal(restored.workstreams.length, archive.state.workstreams.length);
  assert.equal(restored.actions.length, archive.state.actions.length);
  assert.equal(restored.grants.length, archive.state.grants.length);
  assert(restored.audit.length >= archive.state.audit.length);
  assert.equal(restored.workstreams[0].title, 'Fictional publication task');
  for (const file of archive.files) {
    const path: string = file.path.replace(`${archive.state.workspaceId}/`, `${workspace.id}/`);
    const { data, error } = await db.storage.from('evidence').download(path);
    assert.ifError(error);
    assert(data);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await data.arrayBuffer()))
        .digest('hex'),
      file.sha256,
    );
    const privateRead = await client.storage.from('evidence').download(path);
    assert(privateRead.error, 'Owner auth cannot bypass service-only private evidence access');
  }
  const creds = await db.from('agent_credentials').select('id');
  assert.ifError(creds.error);
  assert.equal(creds.data!.length, 0);
  const owner = restored.identities.find((i) => i.kind === 'human')!;
  const agent = restored.identities.find((i) => i.kind === 'agent')!;
  const fresh = await createCredential(
    { id: owner.id, workspaceId: workspace.id, kind: 'human', scopes: ['*'], assignments: [] },
    { identityId: agent.id, assignments: [restored.workstreams[0].id], scopes: ['read'] },
    randomUUID(),
  );
  assert(fresh.token);
  const actor = await authenticate(
    new Request(`${origin}/mcp`, { headers: { Authorization: `Bearer ${fresh.token}` } }),
  );
  assert.equal(actor.id, agent.id);
  console.log(
    'PASS: separate destination restore, records/audit/evidence checksums, credential exclusion and fresh credential authentication',
  );
}
