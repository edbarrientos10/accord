import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, MemoryRepository } from './helpers';
import { applyCommand, visibleState } from '../src/domain/service';
import { canUseCommand } from '../src/domain/access';
import { agentScopes, workspaceCommandScopes } from '../src/domain/permissions';
import { execute } from '../src/server/repository';
import { scopedExport } from '../src/server/export';
import type { Actor, Workstream, Project, Operation } from '../src/domain/types';

function setup() {
  const f = fixture();
  const actor: Actor = {
    ...f.agent,
    assignments: [],
    accessMode: 'workspace',
    scopes: ['read', ...agentScopes, ...workspaceCommandScopes, 'workstream.manage'],
  };
  const task = f.create();
  f.state.workstreams[0].assignedAgentIds = [];
  return { f, actor, task };
}
const taskInput = (ownerId: string) => ({
  title: 'Workspace task',
  outcome: 'Organized work',
  ownerId,
  assignedAgentIds: [],
  criteria: [],
  completionPolicy: 'simple',
  nextAction: null,
  reason: 'Manage the workspace',
});

describe('workspace-wide agent authorization', () => {
  it('reads current/future unassigned tasks, routines and empty projects, without People or foreign workspace access', () => {
    const { f, actor, task } = setup();
    const project = f.command('project.create', {
      name: 'Empty project',
      reason: 'Plan',
    }) as Project;
    expect(visibleState(f.state, actor).projects).toEqual([project]);
    expect(visibleState(f.state, actor).workstreams.map((w) => w.id)).toEqual([task.id]);
    const next = f.command('workstream.create', taskInput(f.human.id)) as Workstream;
    const routine = f.command('operation.create', {
      title: 'Routine',
      purpose: 'Observe',
      ownerId: f.human.id,
      cadenceHours: 24,
      expectedAt: '2099-01-01T00:00:00.000Z',
      reason: 'Plan',
    }) as Operation;
    const visible = visibleState(f.state, actor);
    expect(visible.workstreams.map((w) => w.id)).toContain(next.id);
    expect(visible.operations.map((o) => o.id)).toContain(routine.id);
    expect(visible.people).toEqual([]);
    expect(visible.identities.every((i) => !i.authUserId)).toBe(true);
    expect(visibleState(f.state, f.agent).workstreams).toEqual([]);
    expect(visibleState(f.state, { ...actor, scopes: ['people.read'] }).projects).toEqual([]);
    expect(() => visibleState(f.state, { ...actor, workspaceId: randomUUID() })).toThrow(
      /Workspace mismatch/,
    );
    expect(() =>
      applyCommand(f.state, { ...actor, workspaceId: randomUUID() }, 'project.create', {
        name: 'Wrong workspace',
        reason: 'Reject',
      }),
    ).toThrow(/Workspace mismatch/);
    expect(scopedExport(visible, [next.id]).workstreams).toHaveLength(1);
  });

  it('creates/edits projects, tasks and routines, terminates/reopens tasks and replays project results', async () => {
    const { f, actor } = setup();
    const project = f.command(
      'project.create',
      { name: 'Agent project', reason: 'Plan' },
      actor,
    ) as Project;
    f.command(
      'project.update',
      { entityId: project.id, expectedVersion: 1, name: 'Updated', reason: 'Organize' },
      actor,
    );
    const task = f.command('workstream.create', taskInput(f.human.id), actor) as Workstream;
    f.command(
      'workstream.update',
      {
        entityId: task.id,
        expectedVersion: task.version,
        ownerId: actor.id,
        assignedAgentIds: [actor.id],
        projectId: project.id,
        reason: 'Organize',
      },
      actor,
    );
    f.command(
      'workstream.terminate',
      {
        entityId: task.id,
        expectedVersion: f.current(task.id).version,
        disposition: 'cancelled',
        reason: 'Cancel',
      },
      actor,
    );
    f.command(
      'workstream.reopen',
      { entityId: task.id, expectedVersion: f.current(task.id).version, reason: 'Resume' },
      actor,
    );
    expect(f.current(task.id).status).toBe('open');
    const routine = f.command(
      'operation.create',
      {
        title: 'Routine',
        purpose: 'Observe',
        ownerId: f.human.id,
        cadenceHours: 24,
        expectedAt: '2099-01-01T00:00:00.000Z',
        reason: 'Plan',
      },
      actor,
    ) as Operation;
    f.command(
      'operation.update',
      {
        entityId: routine.id,
        expectedVersion: routine.version,
        title: 'Updated routine',
        assignedAgentIds: [actor.id],
        reason: 'Organize',
      },
      actor,
    );
    expect(f.state.operations[0].title).toBe('Updated routine');
    const repo = new MemoryRepository(f.state);
    const input = { name: 'Retry project', reason: 'Plan' };
    const first = await execute(repo, actor, 'project.create', input, 'workspace-project-retry');
    expect(await execute(repo, actor, 'project.create', input, 'workspace-project-retry')).toEqual(
      first,
    );
    await expect(
      execute(
        repo,
        { ...actor, accessMode: 'assigned' },
        'project.create',
        input,
        'workspace-project-retry',
      ),
    ).rejects.toThrow();
  });

  it('requires workspace mode and each exact management capability, and preserves protected commands', () => {
    const { actor } = setup();
    for (const name of workspaceCommandScopes) {
      expect(canUseCommand(actor, name)).toBe(true);
      expect(canUseCommand({ ...actor, scopes: [] }, name)).toBe(false);
      expect(canUseCommand({ ...actor, accessMode: 'assigned' }, name)).toBe(false);
      expect(canUseCommand({ ...actor, kind: 'integration' }, name)).toBe(false);
    }
    for (const name of [
      'grant.approve',
      'grant.standing',
      'grant.revoke',
      'decision.respond',
      'identity.create',
      'evidence.invalidate',
      'workspace.timezone',
    ] as const)
      expect(canUseCommand({ ...actor, scopes: [...actor.scopes, name] }, name)).toBe(false);
  });

  it('requires workstream.manage for organization and never permits changing safeguards or clearing conflicts', () => {
    const { f, actor, task } = setup();
    const update = (patch: object, a = actor) =>
      f.command(
        'workstream.update',
        {
          entityId: task.id,
          expectedVersion: f.current(task.id).version,
          reason: 'Organize',
          ...patch,
        },
        a,
      );
    expect(() =>
      update({ ownerId: actor.id }, { ...actor, scopes: ['workstream.update'] }),
    ).toThrow(/workstream.manage/);
    expect(() =>
      update({ title: 'Missing update' }, { ...actor, scopes: ['workstream.manage'] }),
    ).toThrow(/scope/);
    for (const patch of [
      { criteria: [] },
      { completionPolicy: 'simple' },
      { mode: 'autonomous' },
      { outcome: 'Changed definition' },
    ])
      expect(() => update(patch)).toThrow(/owner acceptance/);
    const ref = {
      id: randomUUID(),
      system: 'External',
      objectId: '1',
      responsibility: 'Delivery',
      conflict: 'Mismatch',
    };
    update({ references: [ref] });
    expect(() => update({ references: [{ ...ref, conflict: undefined }] })).toThrow(
      /owner reconciles/,
    );
    const routine = f.command(
      'operation.create',
      {
        title: 'Routine',
        purpose: 'Observe',
        ownerId: actor.id,
        cadenceHours: 24,
        expectedAt: '2099-01-01T00:00:00.000Z',
        reason: 'Plan',
      },
      actor,
    ) as Operation;
    expect(() =>
      f.command(
        'operation.update',
        { entityId: routine.id, expectedVersion: 1, grantId: randomUUID(), reason: 'Forge grant' },
        actor,
      ),
    ).toThrow(/Invalid command input/);
  });

  it('completes another owner’s simple task while preserving verified evidence, blockers and reconciliation', () => {
    const { f, actor, task } = setup();
    const simple = f.command('workstream.create', taskInput(f.human.id)) as Workstream;
    f.command(
      'workstream.close',
      { entityId: simple.id, expectedVersion: 1, evidenceIds: [], reason: 'Complete' },
      actor,
    );
    expect(f.current(simple.id).status).toBe('completed');
    expect(f.current(simple.id).verifiedAt).toBeNull();
    expect(() =>
      f.command(
        'workstream.close',
        {
          entityId: task.id,
          expectedVersion: task.version,
          evidenceIds: [],
          humanConfirmation: 'Agent claim',
          reason: 'Complete',
        },
        actor,
      ),
    ).toThrow(/criterion/);
    f.command(
      'workstream.block',
      {
        entityId: task.id,
        expectedVersion: task.version,
        cause: 'Wait',
        attemptedResolution: 'Asked',
        unblockCondition: 'Response',
        resolverId: f.human.id,
        reason: 'Blocked',
      },
      actor,
    );
    expect(() =>
      f.command(
        'workstream.close',
        {
          entityId: task.id,
          expectedVersion: f.current(task.id).version,
          evidenceIds: [],
          reason: 'Complete',
        },
        actor,
      ),
    ).toThrow(/blocker/);
  });

  it('cannot self-verify, approve execution or bypass reconciliation, and closes verified work only after human evidence acceptance', () => {
    const { f, actor, task } = setup();
    const evidence = f.command(
      'evidence.attach',
      {
        workstreamId: task.id,
        expectedVersion: task.version,
        title: 'Delivered result',
        description: 'Artifact',
        provenance: 'Recorded observation',
        criterionIds: [task.criteria[0].id],
        reason: 'Record',
      },
      actor,
    );
    expect(() =>
      f.command(
        'evidence.verify',
        { entityId: evidence.id, expectedVersion: 1, note: 'Self-accept', reason: 'Reject' },
        { ...actor, scopes: [...actor.scopes, 'evidence.verify'] },
      ),
    ).toThrow(/Agents cannot verify/);
    expect(() =>
      f.command(
        'evidence.invalidate',
        { entityId: evidence.id, expectedVersion: 1, reason: 'Reject' },
        { ...actor, scopes: [...actor.scopes, 'evidence.invalidate'] },
      ),
    ).toThrow(/workspace owner/);
    const close = () =>
      f.command(
        'workstream.close',
        {
          entityId: task.id,
          expectedVersion: f.current(task.id).version,
          evidenceIds: [evidence.id],
          reason: 'Complete',
        },
        actor,
      );
    expect(close).toThrow(/criterion/);
    f.command('evidence.verify', {
      entityId: evidence.id,
      expectedVersion: 1,
      note: 'Reviewed',
      reason: 'Accept',
    });
    const ref = {
      id: randomUUID(),
      system: 'Provider',
      objectId: '1',
      responsibility: 'Delivery',
      conflict: 'Mismatch',
    };
    f.command(
      'workstream.update',
      {
        entityId: task.id,
        expectedVersion: f.current(task.id).version,
        references: [ref],
        reason: 'Record conflict',
      },
      actor,
    );
    expect(close).toThrow(/conflicts/);
    f.command('workstream.update', {
      entityId: task.id,
      expectedVersion: f.current(task.id).version,
      references: [{ ...ref, conflict: undefined }],
      reason: 'Reconcile',
    });
    const action = f.command(
      'action.propose',
      {
        workstreamId: task.id,
        expectedVersion: f.current(task.id).version,
        operation: 'send',
        effect: 'Deliver',
        target: 'Recipient',
        content: 'Exact draft',
        scope: 'One delivery',
        expiresAt: '2099-01-01T00:00:00.000Z',
        reason: 'Propose',
      },
      actor,
    );
    expect(() =>
      f.command(
        'grant.approve',
        { entityId: action.id, expectedVersion: 1, granteeId: actor.id, reason: 'Self-approve' },
        { ...actor, scopes: [...actor.scopes, 'grant.approve'] },
      ),
    ).toThrow(/workspace owner/);
    f.command(
      'action.request_approval',
      { entityId: action.id, expectedVersion: 1, reason: 'Ask' },
      actor,
    );
    const grant = f.command('grant.approve', {
      entityId: action.id,
      expectedVersion: f.state.actions[0].version,
      granteeId: actor.id,
      reason: 'Approve',
    });
    const execution = f.command(
      'execution.start',
      {
        actionId: action.id,
        expectedVersion: f.state.actions[0].version,
        grantId: grant.id,
        reason: 'Reserve',
      },
      actor,
    );
    expect(close).toThrow(/running or uncertain/);
    f.command(
      'execution.report',
      {
        entityId: execution.id,
        expectedVersion: 1,
        state: 'uncertain',
        result: 'Await receipt',
        reason: 'Report',
      },
      actor,
    );
    expect(close).toThrow(/running or uncertain/);
    const clean = setup();
    const accepted = clean.f.command(
      'evidence.attach',
      {
        workstreamId: clean.task.id,
        expectedVersion: 1,
        title: 'Result',
        description: 'Artifact',
        provenance: 'Observation',
        criterionIds: [clean.task.criteria[0].id],
        reason: 'Record',
      },
      clean.actor,
    );
    clean.f.command('evidence.verify', {
      entityId: accepted.id,
      expectedVersion: 1,
      note: 'Reviewed',
      reason: 'Accept',
    });
    clean.f.command(
      'workstream.close',
      {
        entityId: clean.task.id,
        expectedVersion: clean.f.current(clean.task.id).version,
        evidenceIds: [accepted.id],
        reason: 'Complete',
      },
      clean.actor,
    );
    expect(clean.f.current(clean.task.id).status).toBe('completed');
  });

  it('links People commitments to unassigned tasks and empty projects only with explicit People scopes', () => {
    const { f, actor, task } = setup();
    const a = { ...actor, scopes: [...actor.scopes, 'people.read'] };
    const person = f.command('person.create', { name: 'Contact', reason: 'Record' }, a);
    const project = f.command('project.create', { name: 'Empty', reason: 'Plan' }, actor);
    f.command(
      'commitment.create',
      {
        personId: person.id,
        direction: 'i_owe',
        coordinatorId: actor.id,
        title: 'Follow up',
        workstreamId: task.id,
        reason: 'Link',
      },
      a,
    );
    f.command(
      'commitment.create',
      {
        personId: person.id,
        direction: 'i_owe',
        coordinatorId: actor.id,
        title: 'Plan',
        projectId: project.id,
        reason: 'Link',
      },
      a,
    );
    expect(visibleState(f.state, a).commitments[0].workstreamId).toBe(task.id);
    expect(visibleState(f.state, a).commitments[1].projectId).toBe(project.id);
    expect(visibleState(f.state, actor).commitments).toEqual([]);
    expect(() => f.command('person.create', { name: 'Hidden', reason: 'Reject' }, actor)).toThrow(
      /People read/,
    );
  });
});
