import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, MemoryRepository } from './helpers';
import { applyCommand, visibleState } from '../src/domain/service';
import { decisionQueue } from '../src/domain/presentation';
import { execute } from '../src/server/repository';
import { scopedExport, validateArchive, prepareRestore } from '../src/server/export';
import type { Workstream, Project, Action } from '../src/domain/types';
const now = '2026-10-26T12:00:00.000Z';
function simple() {
  const f = fixture();
  const w = f.command('workstream.create', {
    title: 'Quick task',
    outcome: 'Quick task',
    ownerId: f.agent.id,
    assignedAgentIds: [f.agent.id],
    criteria: [],
    nextAction: null,
    completionPolicy: 'simple',
    reason: 'Test simple',
  }) as Workstream;
  f.agent.assignments = [w.id];
  return { f, w };
}
function proposal() {
  const f = fixture(),
    w = f.create();
  const a = f.command('action.propose', {
    workstreamId: w.id,
    expectedVersion: w.version,
    operation: 'send',
    effect: 'Send draft',
    target: 'fictional',
    scope: 'One message',
    content: 'Exact text',
    expiresAt: '2099-01-01T00:00:00.000Z',
    reason: 'Propose',
  }) as Action;
  f.command('action.request_approval', {
    entityId: a.id,
    expectedVersion: a.version,
    reason: 'Request',
  });
  return { f, w, a: f.state.actions[0] };
}
describe('project and task redesign', () => {
  it('preserves verified legacy creation and rejects empty verified criteria', () => {
    const f = fixture(),
      w = f.create();
    expect(w.completionPolicy).toBe('verified');
    expect(() =>
      f.command('workstream.create', {
        title: 'Empty',
        outcome: 'Empty',
        ownerId: f.human.id,
        criteria: [],
        nextAction: null,
        reason: 'Empty',
      }),
    ).toThrow(/criteria/);
  });
  it('lets the assigned simple task owner complete without claiming verification', () => {
    const { f, w } = simple();
    const result = f.command(
      'workstream.close',
      { entityId: w.id, expectedVersion: w.version, evidenceIds: [], reason: 'Finished' },
      f.agent,
    ) as Workstream;
    expect(result.status).toBe('completed');
    expect(result.verifiedAt).toBeNull();
    expect(result.closure?.actorId).toBe(f.agent.id);
  });
  it('prevents another assigned agent from completing a simple task or weakening policy', () => {
    const { f, w } = simple();
    f.command('workstream.update', {
      entityId: w.id,
      expectedVersion: w.version,
      ownerId: f.human.id,
      reason: 'Human owns',
    });
    expect(() =>
      f.command(
        'workstream.close',
        {
          entityId: w.id,
          expectedVersion: f.current(w.id).version,
          evidenceIds: [],
          reason: 'Finish',
        },
        f.agent,
      ),
    ).toThrow(/task owner/);
    expect(() =>
      f.command(
        'workstream.update',
        {
          entityId: w.id,
          expectedVersion: f.current(w.id).version,
          completionPolicy: 'simple',
          reason: 'Change',
        },
        f.agent,
      ),
    ).toThrow(/owner acceptance/);
  });
  it('retains blocker and uncertain-execution gates for simple completion', () => {
    const { f, w } = simple();
    f.command('workstream.block', {
      entityId: w.id,
      expectedVersion: w.version,
      cause: 'Missing file',
      attemptedResolution: 'Looked',
      unblockCondition: 'File available',
      resolverId: f.human.id,
      reason: 'Blocked',
    });
    expect(() =>
      f.command('workstream.close', {
        entityId: w.id,
        expectedVersion: f.current(w.id).version,
        evidenceIds: [],
        reason: 'Finish',
      }),
    ).toThrow(/blocker/);
    f.command('workstream.unblock', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      reason: 'File found',
    });
    f.state.executions.push({
      id: randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      workstreamId: w.id,
      grantId: randomUUID(),
      actorId: f.agent.id,
      state: 'uncertain',
      result: 'Unknown',
      evidenceIds: [],
    });
    expect(() =>
      f.command('workstream.close', {
        entityId: w.id,
        expectedVersion: f.current(w.id).version,
        evidenceIds: [],
        reason: 'Finish',
      }),
    ).toThrow(/uncertain/);
  });
  it('groups tasks without expanding agent visibility, including project audit history', () => {
    const f = fixture(),
      first = f.create(),
      second = f.create();
    const p = f.command('project.create', { name: 'Private project', reason: 'Group' }) as Project;
    for (const w of [first, second])
      f.command('workstream.update', {
        entityId: w.id,
        expectedVersion: w.version,
        projectId: p.id,
        reason: 'Group',
      });
    f.agent.assignments = [first.id];
    const view = visibleState(f.state, f.agent);
    expect(view.projects.map((p) => p.id)).toEqual([p.id]);
    expect(view.workstreams.map((w) => w.id)).toEqual([first.id]);
    expect(JSON.stringify(view)).not.toContain(second.id);
    expect(() =>
      f.command(
        'project.update',
        { entityId: p.id, expectedVersion: p.version, name: 'Agent rename', reason: 'Rename' },
        f.agent,
      ),
    ).toThrow();
    f.agent.assignments = [p.id];
    expect(visibleState(f.state, f.agent).workstreams).toHaveLength(0);
    expect(visibleState(f.state, f.agent).projects).toHaveLength(0);
  });
  it('keeps archived project tasks in Today', () => {
    const f = fixture(),
      w = f.create(),
      p = f.command('project.create', { name: 'Archive me', reason: 'Create' }) as Project;
    f.command('workstream.update', {
      entityId: w.id,
      expectedVersion: w.version,
      projectId: p.id,
      reviewAt: '2020-01-01T00:00:00.000Z',
      reason: 'Group',
    });
    f.command('project.update', {
      entityId: p.id,
      expectedVersion: p.version,
      status: 'archived',
      reason: 'Archive',
    });
    expect(decisionQueue(f.state, Date.parse(now)).some((q) => q.taskId === w.id)).toBe(true);
  });
  it.each(['declined', 'changes_requested'] as const)(
    'records %s and requires a fresh proposal revision',
    (response) => {
      const { f, w, a } = proposal();
      f.command('decision.respond', {
        entityId: a.id,
        expectedVersion: a.version,
        response,
        feedback: 'Change the target',
        reason: 'Feedback',
      });
      expect(f.state.grants).toHaveLength(0);
      expect(decisionQueue(f.state).some((q) => q.subjectId === a.id)).toBe(false);
      expect(visibleState(f.state, f.agent).decisions[0].feedback).toBe('Change the target');
      expect(() =>
        f.command('action.request_approval', {
          entityId: a.id,
          expectedVersion: f.state.actions[0].version,
          reason: 'Again',
        }),
      ).toThrow(/new proposal revision/);
      expect(() =>
        f.command('grant.approve', {
          entityId: a.id,
          expectedVersion: f.state.actions[0].version,
          granteeId: f.agent.id,
          reason: 'Approve',
        }),
      ).toThrow();
      const revised = f.command('action.propose', {
        workstreamId: w.id,
        expectedVersion: f.current(w.id).version,
        operation: a.operation,
        effect: a.effect,
        target: 'new-target',
        scope: a.scope,
        content: 'New text',
        expiresAt: a.expiresAt,
        supersedesId: a.id,
        reason: 'Revise',
      }) as Action;
      expect(revised.revision).toBe(2);
    },
  );
  it('returns completion reviews with agent-readable feedback and accepts later reviews', () => {
    const { f, w } = simple();
    f.command('workstream.review', {
      entityId: w.id,
      expectedVersion: w.version,
      reason: 'Review',
    });
    f.command('decision.respond', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      response: 'changes_requested',
      feedback: 'Include the index',
      reason: 'Return',
    });
    expect(f.current(w.id).status).toBe('open');
    expect(f.state.decisions[0].subjectVersion).toBe(2);
    f.command('workstream.review', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      reason: 'Re-review',
    });
    f.command('workstream.close', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      evidenceIds: [],
      reason: 'Accepted',
    });
    expect(f.state.decisions.map((d) => d.response)).toEqual(['changes_requested', 'accepted']);
  });
  it('snoozes reminders, expires them and invalidates them on record change', () => {
    const { f, a } = proposal();
    f.command('reminder.snooze', {
      entityId: a.id,
      expectedVersion: a.version,
      until: '2099-01-01T00:00:00.000Z',
      reason: 'Later',
    });
    expect(
      decisionQueue(f.state, Date.parse(now)).find((q) => q.subjectId === a.id)?.snoozedUntil,
    ).toBeTruthy();
    expect(
      decisionQueue(f.state, Date.parse('2100-01-01T00:00:00Z')).find((q) => q.subjectId === a.id)
        ?.snoozedUntil,
    ).toBeUndefined();
    expect(visibleState(f.state, f.agent).reminders).toEqual([]);
    f.command('action.request_approval', {
      entityId: a.id,
      expectedVersion: a.version,
      reason: 'Updated request',
    });
    expect(decisionQueue(f.state).find((q) => q.subjectId === a.id)?.snoozedUntil).toBeUndefined();
  });
  it('deduplicates task reasons but retains independent proposals and orders incidents first', () => {
    const { f, w } = simple();
    f.command('workstream.block', {
      entityId: w.id,
      expectedVersion: w.version,
      cause: 'Blocked',
      attemptedResolution: 'Tried',
      unblockCondition: 'Unblocked',
      resolverId: f.human.id,
      reason: 'Block',
    });
    f.command('workstream.update', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      reviewAt: '2020-01-01T00:00:00.000Z',
      dueDate: '2020-01-01',
      reason: 'Dates',
    });
    const q = decisionQueue(f.state, Date.parse(now));
    expect(q.filter((q) => q.taskId === w.id)).toHaveLength(1);
    expect(q[0].reasons.length).toBeGreaterThanOrEqual(3);
  });
  it('enforces stale-version and content-bound idempotency for new commands', async () => {
    const f = fixture(),
      repo = new MemoryRepository(f.state),
      input = { name: 'One project', reason: 'Create' };
    await execute(repo, f.human, 'project.create', input, 'project-retry');
    await execute(repo, f.human, 'project.create', input, 'project-retry');
    expect(repo.state.projects).toHaveLength(1);
    await expect(
      execute(repo, f.human, 'project.create', { ...input, name: 'Other' }, 'project-retry'),
    ).rejects.toThrow(/Changed retry/);
    expect(() =>
      applyCommand(repo.state, f.human, 'project.update', {
        entityId: repo.state.projects[0].id,
        expectedVersion: 7,
        name: 'Stale',
        reason: 'Stale',
      }),
    ).toThrow(/Reload/);
  });
  it('imports v1 archives and roundtrips projects, decisions and reminders without sibling leakage', () => {
    const { f, w, a } = proposal(),
      p = f.command('project.create', { name: 'Restore project', reason: 'Create' }) as Project;
    f.command('workstream.update', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      projectId: p.id,
      reason: 'Group',
    });
    f.command('reminder.snooze', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      until: '2099-01-01T00:00:00.000Z',
      reason: 'Later',
    });
    f.command('decision.respond', {
      entityId: a.id,
      expectedVersion: a.version,
      response: 'declined',
      feedback: 'Not needed',
      reason: 'Decline',
    });
    const scoped = scopedExport(f.state, [p.id]);
    const archive = validateArchive({
      format: 'accord.v2',
      exportedAt: now,
      state: scoped,
      files: [],
    });
    expect(archive.state.projects).toHaveLength(1);
    expect(archive.state.decisions).toHaveLength(1);
    expect(archive.state.reminders).toHaveLength(1);
    const target = fixture();
    target.state.identities = target.state.identities.filter((i) => i.kind === 'human');
    expect(prepareRestore(archive, target.state).decisions[0].actorId).toBe(target.human.id);
    const old = fixture();
    old.create();
    const legacy = JSON.parse(
      JSON.stringify(scopedExport(old.state, [old.state.workstreams[0].id])),
    );
    delete legacy.projects;
    delete legacy.decisions;
    delete legacy.reminders;
    delete legacy.workstreams[0].completionPolicy;
    const imported = validateArchive({
      format: 'accord.v1',
      exportedAt: now,
      state: legacy,
      files: [],
    });
    expect(imported.format).toBe('accord.v3');
    expect(imported.state.workstreams[0].completionPolicy).toBe('verified');
  });
  it('new execution results invalidate a snooze without a task version change', () => {
    const { f, w, a } = proposal();
    const g = f.command('grant.approve', {
      entityId: a.id,
      expectedVersion: a.version,
      granteeId: f.agent.id,
      reason: 'Approve',
    });
    const e = f.command(
      'execution.start',
      {
        actionId: a.id,
        expectedVersion: f.state.actions[0].version,
        grantId: g.id,
        reason: 'Attempt',
      },
      f.agent,
    );
    const version = f.current(w.id).version;
    f.command('reminder.snooze', {
      entityId: w.id,
      expectedVersion: version,
      until: '2099-01-01T00:00:00.000Z',
      reason: 'Later',
    });
    f.command(
      'execution.report',
      {
        entityId: e.id,
        expectedVersion: 1,
        state: 'failed',
        result: 'Provider rejected the request',
        reason: 'Observed',
      },
      f.agent,
    );
    expect(f.current(w.id).version).toBe(version);
    expect(Date.parse(f.state.reminders[0].until)).toBeLessThan(
      Date.parse('2099-01-01T00:00:00.000Z'),
    );
    expect(decisionQueue(f.state, Date.parse(now))[0].kind).toBe('incident');
  });
});
