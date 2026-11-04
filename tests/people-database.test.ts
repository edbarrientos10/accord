import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers';
import { applyCommand } from '../src/domain/service';
import type { State, Person } from '../src/domain/types';
it('migrates populated third-party identities and persists People with owner RLS and atomic retries', async () => {
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
    const f = fixture();
    const task = f.create();
    await db.query('insert into auth.users(id) values($1)', [f.state.identities[0].authUserId]);
    await db.query('insert into workspaces(id,name,owner_auth_user_id) values($1,$2,$3)', [
      f.state.workspaceId,
      'Legacy',
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
      'legacy-task',
      'hash',
      JSON.stringify(f.state),
      JSON.stringify(task),
    ]);
    await db.exec(await readFile('supabase/migrations/202610260002_people.sql', 'utf8'));
    const load = async () =>
      (await db.query<{ s: State }>('select accord_snapshot($1) s', [f.state.workspaceId])).rows[0]
        .s;
    let state = await load();
    expect(state.people[0].id).toBe(f.thirdId);
    expect(state.people[0].groupId).toBe(
      state.relationshipGroups.find((g) => g.name === 'Other')?.id,
    );
    expect(state.workstreams).toEqual(f.state.workstreams);
    expect(state.audit).toEqual(f.state.audit);
    expect(state.relationshipGroups).toHaveLength(4);
    let n = 0;
    const commit = async (name: string, input: unknown) => {
      const before = state,
        result = applyCommand(state, f.human, name, input);
      const args = [
        state.workspaceId,
        state.revision,
        f.human.id,
        'people-db-' + ++n,
        'hash-' + n,
        JSON.stringify(result.state),
        JSON.stringify(result.result),
      ];
      await db.query('select accord_commit($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,null)', args);
      state = await load();
      return { result: result.result, args };
    };
    const person = state.people[0];
    const updated = await commit('person.update', {
      entityId: person.id,
      expectedVersion: person.version,
      notes: 'Keep this context',
      reason: 'Edit profile',
    });
    expect(state.people[0].notes).toBe('Keep this context');
    const auditCount = state.audit.length;
    await db.query('select accord_commit($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,null)', updated.args);
    expect((await load()).audit).toHaveLength(auditCount);
    await commit('commitment.create', {
      personId: person.id,
      title: 'Delivery',
      direction: 'waiting_on',
      coordinatorId: f.human.id,
      workstreamId: task.id,
      required: true,
      reason: 'Track delegation',
    });
    await commit('important_date.create', {
      personId: person.id,
      title: 'Birthday',
      kind: 'birthday',
      month: 2,
      day: 29,
      year: null,
      reason: 'Remember',
    });
    await commit('interaction.log', {
      personId: person.id,
      occurredAt: '2026-01-01T12:00:00Z',
      channel: 'call',
      summary: 'Caught up',
      meaningful: true,
      reason: 'Record',
    });
    expect(state.commitments).toHaveLength(1);
    expect(state.importantDates).toHaveLength(1);
    expect(state.interactions).toHaveLength(1);
    const before = state.revision;
    await expect(
      db.query('select accord_commit($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,null)', [
        state.workspaceId,
        state.revision,
        f.human.id,
        'broken-transaction',
        'hash',
        JSON.stringify({
          ...state,
          revision: state.revision + 1,
          people: [{ ...state.people[0], groupId: randomUUID() }],
        }),
        '{}',
      ]),
    ).rejects.toThrow();
    expect((await load()).revision).toBe(before);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [randomUUID()]);
    expect((await db.query('select * from people')).rows).toHaveLength(0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.state.identities[0].authUserId,
    ]);
    expect((await db.query('select * from people')).rows).toHaveLength(1);
    await expect(db.query("update people set body='{}'::jsonb")).rejects.toThrow();
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});
