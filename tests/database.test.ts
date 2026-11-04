import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Actor, State } from '../src/domain/types';
import { fixture } from './helpers';
import { applyCommand } from '../src/domain/service';
import { hash, execute, type Repository } from '../src/server/repository';
import { scopedExport, validateArchive, prepareRestore } from '../src/server/export';
class DatabaseRepository implements Repository {
  constructor(public db: PGlite) {}
  async load(id: string) {
    const r = await this.db.query<{ s: State }>('select accord_snapshot($1::uuid) s', [id]);
    return r.rows[0].s;
  }
  async replay(a: Actor, key: string, h: string) {
    const r = await this.db.query<{ request_hash: string; result: unknown }>(
      'select request_hash,result from idempotency_records where workspace_id=$1 and actor_id=$2 and key=$3',
      [a.workspaceId, a.id, key],
    );
    if (r.rows[0]) {
      if (r.rows[0].request_hash !== h) throw new Error('idempotency_mismatch');
      return r.rows[0].result;
    }
  }
  async commit(a: Actor, key: string, h: string, before: State, after: State, result: unknown) {
    const r = await this.db.query<{ r: { conflict?: boolean; result?: unknown } }>(
      'select accord_commit($1::uuid,$2::bigint,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8::uuid) r',
      [
        a.workspaceId,
        before.revision,
        a.id,
        key,
        h,
        JSON.stringify(after),
        JSON.stringify(result),
        a.credentialId ?? null,
      ],
    );
    return r.rows[0].r;
  }
}
describe('real PostgreSQL migration and atomic commit', () => {
  let db: PGlite, repo: DatabaseRepository;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);",
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    repo = new DatabaseRepository(db);
  });
  afterAll(async () => {
    await db.close();
  });
  async function install() {
    const f = fixture();
    await db.query('insert into auth.users(id) values($1)', [f.state.identities[0].authUserId]);
    await db.query('insert into workspaces(id,name,owner_auth_user_id) values($1,$2,$3)', [
      f.state.workspaceId,
      'Fictional',
      f.state.identities[0].authUserId,
    ]);
    for (const i of f.state.identities)
      await db.query(
        'insert into identities(id,workspace_id,kind,body) values($1,$2,$3,$4::jsonb)',
        [i.id, f.state.workspaceId, i.kind, JSON.stringify(i)],
      );
    f.agent.credentialId = randomUUID();
    await db.query(
      'insert into agent_credentials(id,workspace_id,identity_id,token_hash,scopes,assignments,expires_at) values($1,$2,$3,$4,$5::text[],$6::uuid[],$7)',
      [
        f.agent.credentialId,
        f.state.workspaceId,
        f.agent.id,
        randomUUID(),
        f.agent.scopes,
        [],
        '2099-01-01T00:00:00.000Z',
      ],
    );
    return f;
  }
  it('persists owner profile details and clears the optional role', async () => {
    const f = await install();
    const input = {
      name: 'Jamie Taylor',
      role: 'Designer',
      expectedVersion: 0,
      reason: 'Set profile',
    };
    await execute(repo, f.human, 'profile.update', input, 'profile-db-update');
    await execute(repo, f.human, 'profile.update', input, 'profile-db-update');
    let state = await repo.load(f.state.workspaceId);
    expect(state.identities.find((i) => i.id === f.human.id)).toMatchObject({
      name: 'Jamie Taylor',
      role: 'Designer',
      authUserId: f.state.identities[0].authUserId,
    });
    expect(state.audit).toHaveLength(1);
    await execute(
      repo,
      f.human,
      'profile.update',
      { ...input, role: '', expectedVersion: state.revision },
      'profile-db-clear',
    );
    state = await repo.load(f.state.workspaceId);
    expect(state.identities.find((i) => i.id === f.human.id)?.role).toBeUndefined();
  });
  it('commits state, audit and idempotency together; CAS catches competing updates', async () => {
    const f = await install(),
      p = {
        title: 'Database outcome',
        outcome: 'Verified database behavior',
        ownerId: f.human.id,
        assignedAgentIds: [f.agent.id],
        criteria: [{ id: randomUUID(), text: 'Acceptance' }],
        nextAction: null,
        reason: 'Database test',
      },
      w = (await execute(repo, f.human, 'workstream.create', p, 'database-create')) as {
        id: string;
        version: number;
      };
    f.agent.assignments.push(w.id);
    const before = await repo.load(f.human.workspaceId),
      a = applyCommand(before, f.agent, 'workstream.update', {
        entityId: w.id,
        expectedVersion: 1,
        reportedProgress: 'First',
        reason: 'First writer',
      }),
      b = applyCommand(before, f.agent, 'workstream.update', {
        entityId: w.id,
        expectedVersion: 1,
        reportedProgress: 'Second',
        reason: 'Second writer',
      });
    const c1 = await repo.commit(f.agent, 'db-writer-a', hash('a'), before, a.state, a.result),
      c2 = await repo.commit(f.agent, 'db-writer-b', hash('b'), before, b.state, b.result);
    expect(c1.conflict).toBeUndefined();
    expect(c2.conflict).toBe(true);
    const current = await repo.load(f.human.workspaceId);
    expect(current.workstreams[0].reportedProgress).toBe('First');
    expect(current.audit).toHaveLength(2);
    const r = await repo.commit(f.agent, 'db-writer-a', hash('a'), before, a.state, a.result);
    expect(r.result).toEqual(a.result);
    await expect(
      repo.commit(f.agent, 'db-writer-a', hash('changed'), before, a.state, a.result),
    ).rejects.toThrow(/idempotency_mismatch/);
  });
  it('persists task links through JSON snapshots, edits, removal and idempotent retries', async () => {
    const f = await install();
    const link = {
      id: randomUUID(),
      title: 'Delivery notes',
      url: 'https://example.com/notes',
      note: 'For review',
    };
    const w = (await execute(
      repo,
      f.human,
      'workstream.create',
      {
        title: 'Linked task',
        outcome: 'Deliver notes',
        ownerId: f.human.id,
        completionPolicy: 'simple',
        criteria: [],
        nextAction: null,
        links: [link],
        reason: 'Create linked task',
      },
      'db-linked-task',
    )) as { id: string; version: number };
    expect((await repo.load(f.state.workspaceId)).workstreams[0].links).toEqual([link]);
    const input = {
      entityId: w.id,
      expectedVersion: w.version,
      links: [{ ...link, title: 'Final notes' }],
      reason: 'Update resource',
    };
    await execute(repo, f.human, 'workstream.update', input, 'db-linked-task-edit');
    await execute(repo, f.human, 'workstream.update', input, 'db-linked-task-edit');
    const state = await repo.load(f.state.workspaceId);
    expect(state.workstreams[0].links).toEqual(input.links);
    expect(state.audit).toHaveLength(2);
    expect(state.audit.at(-1)).toMatchObject({
      changes: { before: { links: [link] }, after: { links: input.links } },
    });
    await execute(
      repo,
      f.human,
      'workstream.update',
      {
        ...input,
        expectedVersion: state.workstreams[0].version,
        links: [],
        reason: 'Remove resource',
      },
      'db-linked-task-remove',
    );
    expect((await repo.load(f.state.workspaceId)).workstreams[0].links).toEqual([]);
  });
  it('foreign-key failure rolls back state and audit', async () => {
    const f = await install(),
      before = await repo.load(f.human.workspaceId),
      r = applyCommand(before, f.human, 'workstream.create', {
        title: 'Invalid write',
        outcome: 'Rollback proof',
        ownerId: f.human.id,
        criteria: [{ id: randomUUID(), text: 'No partial write' }],
        nextAction: null,
        reason: 'Test rollback',
      });
    r.state.workstreams[0].ownerId = randomUUID();
    await expect(
      repo.commit(f.human, 'rollback-write', hash('rollback'), before, r.state, r.result),
    ).rejects.toThrow();
    expect((await repo.load(f.human.workspaceId)).workstreams).toHaveLength(0);
    expect((await repo.load(f.human.workspaceId)).audit).toHaveLength(0);
  });
  it('restores portable records and audit into an isolated owner installation without credentials', async () => {
    const source = fixture(),
      w = source.create(),
      archive = validateArchive({
        format: 'accord.v1',
        exportedAt: new Date().toISOString(),
        state: scopedExport(source.state, [w.id]),
        files: [],
      }),
      target = fixture();
    target.state.identities = target.state.identities.filter((i) => i.kind === 'human');
    const owner = target.state.identities[0];
    await db.query('insert into auth.users(id) values($1)', [owner.authUserId]);
    await db.query('insert into workspaces(id,name,owner_auth_user_id) values($1,$2,$3)', [
      target.state.workspaceId,
      'Isolated recovery',
      owner.authUserId,
    ]);
    await db.query('insert into identities(id,workspace_id,kind,body) values($1,$2,$3,$4::jsonb)', [
      owner.id,
      target.state.workspaceId,
      owner.kind,
      JSON.stringify(owner),
    ]);
    const before = await repo.load(target.state.workspaceId),
      after = prepareRestore(archive, before);
    await repo.commit(target.human, 'restore-fixture', hash('restore'), before, after, {
      id: target.state.workspaceId,
    });
    const restored = await repo.load(target.state.workspaceId);
    expect(restored.workstreams[0].id).toBe(w.id);
    expect(restored.workstreams[0].ownerId).toBe(target.human.id);
    expect(restored.audit.length).toBe(archive.state.audit.length + 1);
    const credentials = await db.query<{ count: number }>(
      'select count(*)::int count from agent_credentials where workspace_id=$1',
      [target.state.workspaceId],
    );
    expect(credentials.rows[0].count).toBe(0);
  });
  it('authenticated clients cannot write or invoke commit; owner RLS isolates reads', async () => {
    const f = await install();
    await db.query('select set_config($1,$2,false)', [
      'request.jwt.claim.sub',
      f.state.identities[0].authUserId,
    ]);
    await db.exec('set role authenticated');
    try {
      const result = await db.query<{ id: string }>('select id from workspaces');
      expect(result.rows.map((w) => w.id)).toEqual([f.state.workspaceId]);
      await expect(db.query('update workspaces set revision=99')).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query('select accord_snapshot($1::uuid)', [f.state.workspaceId]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query('select token_hash from agent_credentials')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec('reset role');
    }
  });
  it('audit events reject mutation even by privileged callers', async () => {
    await expect(db.exec("update audit_events set command='forged'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.exec('delete from audit_events')).rejects.toThrow(/append-only/);
  });
  it('rejects an in-flight agent transaction if its credential was revoked after authentication', async () => {
    const f = await install();
    const w = (await execute(
      repo,
      f.human,
      'workstream.create',
      {
        title: 'Revocation fixture',
        outcome: 'Reject a revoked actor',
        ownerId: f.human.id,
        assignedAgentIds: [f.agent.id],
        criteria: [{ id: randomUUID(), text: 'No revoked write' }],
        nextAction: null,
        reason: 'Prepare revocation test',
      },
      'revocation-create',
    )) as { id: string };
    f.agent.assignments = [w.id];
    const before = await repo.load(f.human.workspaceId),
      change = applyCommand(before, f.agent, 'workstream.update', {
        entityId: w.id,
        expectedVersion: 1,
        reportedProgress: 'Must not persist',
        reason: 'Cached actor',
      });
    await db.query('update agent_credentials set revoked_at=now() where id=$1', [
      f.agent.credentialId,
    ]);
    await expect(
      repo.commit(f.agent, 'revoked-write', hash('revoked'), before, change.state, change.result),
    ).rejects.toThrow(/credential_revoked/);
    expect((await repo.load(f.human.workspaceId)).workstreams[0].reportedProgress).toBe(
      'No progress reported',
    );
  });
  it('persists workspace mode atomically, audits it, rejects invalid issuance and rechecks revocation/expiry at commit', async () => {
    const f = await install();
    const legacy = await db.query<{ access_mode: string }>(
      'select access_mode from agent_credentials where id=$1',
      [f.agent.credentialId],
    );
    expect(legacy.rows[0].access_mode).toBe('assigned');
    const id = randomUUID();
    const args = [
      id,
      f.human.workspaceId,
      f.human.id,
      f.agent.id,
      'workspace-hash',
      ['read', 'project.create'],
      [],
      '2027-01-01T00:00:00.000Z',
      'workspace-credential',
      'workspace-request',
      'workspace',
    ];
    const sql =
      'select accord_credential_create($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::text[],$7::uuid[],$8::timestamptz,$9,$10,$11) result';
    const first = await db.query<{ result: { created: boolean } }>(sql, args);
    expect(first.rows[0].result.created).toBe(true);
    expect(
      (await db.query<{ result: { created: boolean } }>(sql, args)).rows[0].result.created,
    ).toBe(false);
    await expect(
      db.query(sql, [...args.slice(0, 9), 'changed-content', 'workspace']),
    ).rejects.toThrow(/idempotency_mismatch/);
    const stored = await db.query<{ access_mode: string; assignments: string[] }>(
      'select access_mode,assignments from agent_credentials where id=$1',
      [id],
    );
    expect(stored.rows[0]).toEqual({ access_mode: 'workspace', assignments: [] });
    const snapshot = await repo.load(f.human.workspaceId);
    expect(snapshot.audit).toHaveLength(1);
    expect(snapshot.audit[0].changes).toMatchObject({ accessMode: 'workspace', assignments: [] });
    for (const [mode, identity, assignments] of [
      ['invalid', f.agent.id, []],
      ['workspace', f.agent.id, [randomUUID()]],
      ['workspace', f.thirdId, []],
      ['workspace', randomUUID(), []],
    ] as const) {
      const invalid = [...args];
      invalid[0] = randomUUID();
      invalid[3] = identity;
      invalid[6] = [...assignments];
      invalid[8] = randomUUID();
      invalid[10] = mode;
      await expect(db.query(sql, invalid)).rejects.toThrow(/invalid_/);
    }
    const actor: Actor = {
      ...f.agent,
      credentialId: id,
      accessMode: 'workspace',
      assignments: [],
      scopes: ['read', 'project.create'],
    };
    const before = await repo.load(actor.workspaceId);
    const change = applyCommand(before, actor, 'project.create', {
      name: 'Must not persist',
      reason: 'Test commit protection',
    });
    for (const mutation of [
      'revoked_at=now()',
      "revoked_at=null,expires_at='2000-01-01'::timestamptz",
    ]) {
      await db.query('update agent_credentials set ' + mutation + ' where id=$1', [id]);
      await expect(
        repo.commit(
          actor,
          'workspace-revoked-write',
          hash('cached'),
          before,
          change.state,
          change.result,
        ),
      ).rejects.toThrow(/credential_revoked/);
    }
    expect((await repo.load(actor.workspaceId)).projects).toEqual([]);
  });
  it('credential issuance is retry-safe; revocation checks the current version and stays audited', async () => {
    const f = await install(),
      id = randomUUID(),
      args = [
        id,
        f.human.workspaceId,
        f.human.id,
        f.agent.id,
        'fake-hash',
        ['read'],
        [randomUUID()],
        '2027-01-01T00:00:00.000Z',
        'credential-key',
        'request-hash',
      ];
    const sql =
      'select accord_credential_create($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::text[],$7::uuid[],$8::timestamptz,$9,$10) result';
    const first = await db.query<{ result: { created: boolean } }>(sql, args),
      second = await db.query<{ result: { created: boolean } }>(sql, args);
    expect(first.rows[0].result.created).toBe(true);
    expect(second.rows[0].result.created).toBe(false);
    await expect(
      db.query('select accord_credential_revoke($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)', [
        f.human.workspaceId,
        f.human.id,
        id,
        9,
        'revoke-stale',
        'r1',
      ]),
    ).rejects.toThrow(/conflict/);
    await db.query('select accord_credential_revoke($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)', [
      f.human.workspaceId,
      f.human.id,
      id,
      1,
      'revoke-current',
      'r2',
    ]);
    const credentials = await db.query<{ revoked_at: string }>(
      'select revoked_at from agent_credentials where id=$1',
      [id],
    );
    expect(credentials.rows[0].revoked_at).toBeTruthy();
    expect((await repo.load(f.human.workspaceId)).audit.map((a) => a.command)).toEqual([
      'credential.create',
      'credential.revoke',
    ]);
  });
});
