import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers';
import { applyCommand } from '../src/domain/service';
import type { State } from '../src/domain/types';
import type { LogSummary } from '../src/domain/logs';
it('migrates history, isolates attempt logs, and pages 20000 events without growing current snapshots', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);",
    );
    for (const name of [
      '202610120001_accord.sql',
      '202610120002_credentials.sql',
      '202610120003_bootstrap.sql',
      '202610260001_projects_decisions.sql',
    ])
      await db.exec(await readFile('supabase/migrations/' + name, 'utf8'));
    const f = fixture(),
      task = f.create();
    await db.query('insert into auth.users(id) values($1)', [f.state.identities[0].authUserId]);
    await db.query('insert into workspaces(id,name,owner_auth_user_id) values($1,$2,$3)', [
      f.state.workspaceId,
      'Logs fixture',
      f.state.identities[0].authUserId,
    ]);
    for (const i of f.state.identities)
      await db.query('insert into identities(id,workspace_id,kind,body) values($1,$2,$3,$4)', [
        i.id,
        f.state.workspaceId,
        i.kind,
        JSON.stringify(i),
      ]);
    await db.query('select accord_commit($1,0,$2,$3,$4,$5::jsonb,$6::jsonb,null)', [
      f.state.workspaceId,
      f.human.id,
      'legacy-init',
      'hash',
      JSON.stringify(f.state),
      JSON.stringify(task),
    ]);
    await db.exec(await readFile('supabase/migrations/202610260002_people.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/202610260003_activity_logs.sql', 'utf8'));
    const current = async () =>
      (await db.query<{ s: State }>('select accord_current_snapshot($1) s', [f.state.workspaceId]))
        .rows[0].s;
    const legacy = (
      await db.query<{ s: State }>('select accord_snapshot($1) s', [f.state.workspaceId])
    ).rows[0].s;
    expect(legacy.audit).toEqual(f.state.audit);
    expect((await current()).audit).toEqual([]);
    const before = await current(),
      changed = applyCommand(before, f.human, 'workstream.update', {
        entityId: task.id,
        expectedVersion: task.version,
        reportedProgress: 'Saved after compact load',
        reason: 'New progress',
      });
    await db.query('select accord_commit($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,null)', [
      f.state.workspaceId,
      before.revision,
      f.human.id,
      'compact-commit',
      'hash2',
      JSON.stringify(changed.state),
      JSON.stringify(changed.result),
    ]);
    expect(
      (await db.query<{ n: number }>('select count(*)::int n from audit_events')).rows[0].n,
    ).toBe(f.state.audit.length + 1);
    const compactBytes = JSON.stringify(await current()).length;
    await db.query(
      `insert into audit_events(id,workspace_id,actor_id,entity_id,occurred_at,command,body)
 select id,$1,$2,$3,'2026-10-26T12:00:00Z','workstream.update',jsonb_build_object('id',id,'actorId',$2::uuid,'entityId',$3::uuid,'at','2026-10-26T12:00:00Z','command','workstream.update','reason','Synthetic load test','changes',jsonb_build_object('before',jsonb_build_object('reportedProgress',repeat('x',1000)),'after',jsonb_build_object('title','Load test record','reportedProgress','Updated')))
 from (select gen_random_uuid() id from generate_series(1,20000)) rows`,
      [f.state.workspaceId, f.agent.id, task.id],
    );
    expect(JSON.stringify(await current()).length).toBe(compactBytes);
    await db.exec('analyze activity_log');
    const page = async (at: string | null = null, id: string | null = null) =>
      (
        await db.query<{ rows: LogSummary[] }>(
          'select accord_activity_page($1,$2,$3,$4,$5,null,null,null,$6,$7,50) rows',
          [f.state.workspaceId, 'agents', '', '', '', at, id],
        )
      ).rows[0].rows;
    const first = await page();
    expect(first).toHaveLength(51);
    expect(JSON.stringify(first).length).toBeLessThan(60000);
    expect(first.every((r) => !('changes' in r))).toBe(true);
    const last = first[49],
      second = await page(last.at, last.id);
    expect(second).toHaveLength(51);
    expect(second.every((r) => !first.slice(0, 50).some((a) => a.id === r.id))).toBe(true);
    const event = {
      id: crypto.randomUUID(),
      at: '2026-10-26T13:00:00Z',
      command: 'workstream.update',
      entityId: task.id,
      outcome: 'rejected',
      code: 'conflict',
      message: 'Reload before retrying.',
      transport: 'rest',
      durationMs: 12,
      retryReference: 'safe-hash',
      validationFields: [],
    };
    await db.query('select accord_record_attempt($1,$2,$3)', [
      f.state.workspaceId,
      f.agent.id,
      JSON.stringify(event),
    ]);
    await db.query('select accord_record_attempt($1,$2,$3)', [
      f.state.workspaceId,
      f.agent.id,
      JSON.stringify(event),
    ]);
    expect(
      (
        await db.query<{ n: number }>('select count(*)::int n from activity_log where kind=$1', [
          'attempt',
        ])
      ).rows[0].n,
    ).toBe(1);
    expect((await page())[0].id).toBe(event.id);
    expect((await page(last.at, last.id)).map((r) => r.id)).toEqual(second.map((r) => r.id));
    const plan = JSON.stringify(
      (
        await db.query(
          'explain (analyze,format json) select summary from activity_log where workspace_id=$1 order by occurred_at desc,id desc limit 51',
          [f.state.workspaceId],
        )
      ).rows,
    );
    expect(plan).toContain('activity_page');
    expect(plan).not.toContain('Seq Scan');
    const filtered = (
      await db.query<{ r: LogSummary[] }>(
        'select accord_activity_page($1,$2,$3,$4,$5,$6,$7,$8,null,null,50) r',
        [
          f.state.workspaceId,
          f.agent.id,
          'workstream.update',
          'rejected',
          'Reload',
          '2026-10-26',
          '2026-10-26',
          task.id,
        ],
      )
    ).rows[0].r;
    expect(filtered.map((r) => r.id)).toEqual([event.id]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.state.identities[0].authUserId,
    ]);
    expect(
      (await db.query<{ n: number }>('select count(*)::int n from activity_log')).rows[0].n,
    ).toBeGreaterThan(20000);
    await expect(
      db.query('select accord_activity_page($1)', [f.state.workspaceId]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query('update activity_log set command=$1', ['bad'])).rejects.toThrow(
      /permission denied/,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [crypto.randomUUID()]);
    expect(
      (await db.query<{ n: number }>('select count(*)::int n from activity_log')).rows[0].n,
    ).toBe(0);
    await db.exec('reset role');
    await expect(db.query('delete from activity_log where id=$1', [event.id])).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 60000);
