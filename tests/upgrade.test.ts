import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers';
import { applyCommand } from '../src/domain/service';
import type { State, Project, Action, Grant, Execution } from '../src/domain/types';
it('upgrades populated v1 records and atomically persists isolated projects, decisions and reminders', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);",
    );
    for (const name of [
      '202610120001_accord.sql',
      '202610120002_credentials.sql',
      '202610120003_bootstrap.sql',
    ])
      await db.exec(await readFile('supabase/migrations/' + name, 'utf8'));
    const f = fixture();
    let task = f.create();
    f.command('workstream.update', {
      entityId: task.id,
      expectedVersion: task.version,
      references: [
        {
          id: randomUUID(),
          system: 'Fictional source',
          objectId: 'source-1',
          responsibility: 'Acceptance record',
        },
      ],
      reason: 'Link source',
    });
    const action = f.command(
      'action.propose',
      {
        workstreamId: task.id,
        expectedVersion: f.current(task.id).version,
        operation: 'send',
        effect: 'Send draft',
        target: 'fictional recipient',
        content: 'Preserved exact content',
        scope: 'One message',
        expiresAt: '2099-01-01T00:00:00.000Z',
        reason: 'Prepare',
      },
      f.agent,
    ) as Action;
    f.command(
      'action.request_approval',
      { entityId: action.id, expectedVersion: action.version, reason: 'Review' },
      f.agent,
    );
    const grant = f.command('grant.approve', {
      entityId: action.id,
      expectedVersion: f.state.actions[0].version,
      granteeId: f.agent.id,
      reason: 'Approve',
    }) as Grant;
    const execution = f.command(
      'execution.start',
      {
        actionId: action.id,
        expectedVersion: f.state.actions[0].version,
        grantId: grant.id,
        reason: 'Send',
      },
      f.agent,
    ) as Execution;
    f.command(
      'execution.report',
      {
        entityId: execution.id,
        expectedVersion: execution.version,
        state: 'succeeded',
        result: 'Delivery reported',
        reason: 'Report',
      },
      f.agent,
    );
    f.command(
      'evidence.attach',
      {
        workstreamId: task.id,
        expectedVersion: f.current(task.id).version,
        executionId: execution.id,
        title: 'Delivery record',
        description: 'Preserved delivery evidence',
        provenance: 'Fictional provider',
        criterionIds: [task.criteria[0].id],
        reason: 'Attach',
      },
      f.agent,
    );
    task = f.current(task.id);
    await db.query('insert into auth.users(id) values($1)', [f.state.identities[0].authUserId]);
    await db.query('insert into workspaces(id,name,owner_auth_user_id) values($1,$2,$3)', [
      f.state.workspaceId,
      'Legacy',
      f.state.identities[0].authUserId,
    ]);
    for (const i of f.state.identities)
      await db.query(
        'insert into identities(id,workspace_id,kind,body) values($1,$2,$3,$4::jsonb)',
        [i.id, f.state.workspaceId, i.kind, JSON.stringify(i)],
      );
    const legacy = structuredClone(f.state);
    delete legacy.workstreams[0].completionPolicy;
    delete legacy.workstreams[0].priority;
    delete legacy.workstreams[0].planningStage;
    legacy.decisions = [];
    // A v1 snapshot has no new arrays. Persist at its existing workspace revision.
    delete (legacy as Partial<State>).projects;
    delete (legacy as Partial<State>).decisions;
    delete (legacy as Partial<State>).reminders;
    await db.query('update workspaces set revision=$1 where id=$2', [
      legacy.revision - 1,
      legacy.workspaceId,
    ]);
    await db.query(
      'select accord_commit($1::uuid,$7::bigint,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,null)',
      [
        f.state.workspaceId,
        f.human.id,
        'legacy-create',
        'legacy-hash',
        JSON.stringify(legacy),
        JSON.stringify(task),
        legacy.revision - 1,
      ],
    );
    await db.exec(
      await readFile('supabase/migrations/202610260001_projects_decisions.sql', 'utf8'),
    );
    const load = async () =>
      (await db.query<{ s: State }>('select accord_snapshot($1::uuid) s', [f.state.workspaceId]))
        .rows[0].s;
    let state = await load();
    expect(state.workstreams[0].id).toBe(task.id);
    expect(state.workstreams[0].version).toBe(task.version);
    expect(state.workstreams[0].completionPolicy).toBe('verified');
    expect([...state.audit].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...legacy.audit].sort((a, b) => a.id.localeCompare(b.id)),
    );
    for (const key of ['actions', 'grants', 'executions', 'evidence'] as const)
      expect(state[key]).toEqual(legacy[key]);
    expect(state.workstreams[0].references).toEqual(task.references);
    expect(state.workstreams[0].assignedAgentIds).toEqual(task.assignedAgentIds);
    expect(() =>
      applyCommand(state, f.agent, 'workstream.close', {
        entityId: task.id,
        expectedVersion: task.version,
        evidenceIds: state.evidence.map((e) => e.id),
        reason: 'Cannot skip acceptance',
      }),
    ).toThrow(/criterion/);
    expect(state.projects).toEqual([]);
    let serial = 0;
    const commit = async (name: string, input: unknown) => {
      const before = state;
      const next = applyCommand(before, f.human, name, input);
      await db.query(
        'select accord_commit($1::uuid,$2::bigint,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,null)',
        [
          state.workspaceId,
          state.revision,
          f.human.id,
          'upgrade-' + ++serial,
          'hash-' + serial,
          JSON.stringify(next.state),
          JSON.stringify(next.result),
        ],
      );
      state = await load();
      return next.result;
    };
    const p = (await commit('project.create', {
      name: 'Preserved work',
      reason: 'Group',
    })) as Project;
    await commit('workstream.update', {
      entityId: task.id,
      expectedVersion: task.version,
      projectId: p.id,
      reason: 'Organize',
    });
    await commit('workstream.review', {
      entityId: task.id,
      expectedVersion: state.workstreams[0].version,
      reason: 'Review',
    });
    await commit('decision.respond', {
      entityId: task.id,
      expectedVersion: state.workstreams[0].version,
      response: 'changes_requested',
      feedback: 'Add a reference',
      reason: 'Feedback',
    });
    await commit('reminder.snooze', {
      entityId: task.id,
      expectedVersion: state.workstreams[0].version,
      until: '2099-01-01T00:00:00.000Z',
      reason: 'Later',
    });
    expect(state.projects[0].id).toBe(p.id);
    expect(state.decisions[0].feedback).toBe('Add a reference');
    expect(state.reminders).toHaveLength(1);
    await expect(db.exec("update decisions set body='{}'::jsonb")).rejects.toThrow(/append-only/);
    const credentialId = randomUUID();
    await db.query(
      'insert into agent_credentials(id,workspace_id,identity_id,token_hash,scopes,assignments,expires_at) values($1,$2,$3,$4,$5::text[],$6::uuid[],$7)',
      [
        credentialId,
        f.human.workspaceId,
        f.agent.id,
        'legacy-upgrade-hash',
        ['read'],
        [task.id],
        '2099-01-01',
      ],
    );
    await db.exec(
      await readFile('supabase/migrations/202610270001_workspace_agent_access.sql', 'utf8'),
    );
    expect(
      (
        await db.query('select access_mode,assignments from agent_credentials where id=$1', [
          credentialId,
        ])
      ).rows[0],
    ).toEqual({ access_mode: 'assigned', assignments: [task.id] });
    await db.exec('set role authenticated');
    expect((await db.query('select * from projects')).rows).toHaveLength(0);
    await expect(
      db.exec(
        "insert into projects(id,workspace_id,version,body) values(gen_random_uuid(),gen_random_uuid(),1,'{}')",
      ),
    ).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});
