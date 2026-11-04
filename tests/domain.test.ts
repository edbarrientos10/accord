import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  Action,
  Evidence,
  Execution,
  Grant,
  Operation,
  Workstream,
} from '../src/domain/types';
import { applyCommand, visibleState } from '../src/domain/service';
import { execute } from '../src/server/repository';
import { validateArchive, prepareRestore, scopedExport } from '../src/server/export';
import { fixture, MemoryRepository } from './helpers';
const reason = 'A material change with attributable context';
const future = '2027-01-01T00:00:00.000Z';
function proposal(f: ReturnType<typeof fixture>, w: Workstream, supersedesId?: string) {
  return f.command(
    'action.propose',
    {
      workstreamId: w.id,
      expectedVersion: f.current(w.id).version,
      operation: 'send_email',
      effect: 'Send a proposal for acceptance',
      target: 'fictional-recipient',
      content: 'Fictional content version one',
      scope: 'Send only this exact proposal',
      expiresAt: future,
      reason,
      ...(supersedesId ? { supersedesId } : {}),
    },
    f.agent,
  ) as Action;
}
function approve(f: ReturnType<typeof fixture>, a: Action) {
  a = f.command(
    'action.request_approval',
    { entityId: a.id, expectedVersion: a.version, reason },
    f.agent,
  ) as Action;
  return f.command('grant.approve', {
    entityId: a.id,
    expectedVersion: a.version,
    granteeId: f.agent.id,
    reason,
  }) as Grant;
}
function start(f: ReturnType<typeof fixture>, a: Action, g: Grant) {
  const current = f.state.actions.find((x) => x.id === a.id)!;
  return f.command(
    'execution.start',
    { actionId: a.id, expectedVersion: current.version, grantId: g.id, reason },
    f.agent,
  ) as Execution;
}
describe('outcome scenarios and authority boundaries', () => {
  it('A: assistance preserves next human action and needs attributable acceptance', () => {
    const f = fixture(),
      w = f.create();
    f.command(
      'workstream.update',
      {
        entityId: w.id,
        expectedVersion: w.version,
        nextAction: { text: 'Negotiate the prepared terms', ownerId: f.human.id },
        reportedProgress: 'Draft prepared; not accepted',
        reason,
      },
      f.agent,
    );
    expect(f.current(w.id).nextAction?.ownerId).toBe(f.human.id);
    expect(() =>
      f.command(
        'workstream.close',
        { entityId: w.id, expectedVersion: f.current(w.id).version, evidenceIds: [], reason },
        f.agent,
      ),
    ).toThrow(/criterion/);
    f.command('workstream.close', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      evidenceIds: [],
      humanConfirmation: 'I confirmed that the agreed contract was signed.',
      reason,
    });
    expect(f.current(w.id).status).toBe('completed');
    expect(f.state.audit.at(-1)?.actorId).toBe(f.human.id);
  });
  it('B: approval binds content and sending does not complete coordination', () => {
    const f = fixture(),
      w = f.create(),
      a = proposal(f, w),
      g = approve(f, a);
    expect(f.state.executions).toHaveLength(0);
    const e = start(f, a, g);
    f.command(
      'execution.report',
      {
        entityId: e.id,
        expectedVersion: e.version,
        state: 'succeeded',
        result: 'Provider returned a delivery identifier',
        externalId: 'fictional-delivery-1',
        reason,
      },
      f.agent,
    );
    f.command(
      'workstream.update',
      {
        entityId: w.id,
        expectedVersion: f.current(w.id).version,
        nextAction: { text: 'Wait for acceptance', ownerId: f.thirdId },
        reason,
      },
      f.agent,
    );
    expect(f.current(w.id).status).toBe('open');
    expect(f.state.executions[0].verifiedAt).toBeUndefined();
  });
  it('rejects self-approval, criteria changes, actor spoofing, and self-verification', () => {
    const f = fixture(),
      w = f.create(),
      a = proposal(f, w);
    expect(() =>
      f.command(
        'grant.approve',
        { entityId: a.id, expectedVersion: a.version, granteeId: f.agent.id, reason },
        f.agent,
      ),
    ).toThrow();
    expect(() =>
      f.command(
        'workstream.update',
        {
          entityId: w.id,
          expectedVersion: f.current(w.id).version,
          criteria: [{ id: randomUUID(), text: 'Agent says done' }],
          reason,
        },
        f.agent,
      ),
    ).toThrow(/owner/);
    expect(() =>
      f.command(
        'workstream.review',
        { entityId: w.id, expectedVersion: f.current(w.id).version, actorId: f.human.id, reason },
        f.agent,
      ),
    ).toThrow(/input/);
    const e = f.command(
      'evidence.attach',
      {
        workstreamId: w.id,
        expectedVersion: f.current(w.id).version,
        title: 'Claim',
        description: 'Reported result',
        provenance: 'Agent report',
        criterionIds: [w.criteria[0].id],
        reason,
      },
      f.agent,
    ) as Evidence;
    expect(() =>
      f.command(
        'evidence.verify',
        { entityId: e.id, expectedVersion: e.version, note: 'I verified myself', reason },
        f.agent,
      ),
    ).toThrow(/Agents cannot/);
  });
  it('changed content makes old grants unusable', () => {
    const f = fixture(),
      w = f.create(),
      a = proposal(f, w),
      g = approve(f, a),
      revision = proposal(f, w, a.id);
    expect(() => start(f, a, g)).toThrow(/latest revision/);
    expect(() => start(f, revision, g)).toThrow(/different content revision/);
  });
  it('expired, revoked, exhausted, wrong-target and over-budget grants are rejected', () => {
    const f = fixture(),
      w = f.create(),
      a = proposal(f, w),
      g = approve(f, a);
    const original = structuredClone(f.state);
    f.command('grant.revoke', { entityId: g.id, expectedVersion: g.version, reason });
    expect(() => start(f, a, g)).toThrow(/revoked/);
    f.state = structuredClone(original);
    f.state.grants[0].expiresAt = '2026-01-01T00:00:00.000Z';
    expect(() => start(f, a, g)).toThrow(/expired/);
    f.state = structuredClone(original);
    f.state.grants[0].targets = ['different-target'];
    expect(() => start(f, a, g)).toThrow(/outside/);
    f.state = structuredClone(original);
    f.state.actions[0].declaredCost = 1;
    expect(() => start(f, a, g)).toThrow(/cost limit/);
    f.state = structuredClone(original);
    start(f, a, g);
    expect(() => start(f, a, g)).toThrow();
  });
  it('D: partial delivery needs evidence before an assigned agent can close', () => {
    const f = fixture(),
      w = f.create();
    const e = f.command(
      'evidence.attach',
      {
        workstreamId: w.id,
        expectedVersion: w.version,
        title: 'Reviewed deliverable',
        description: 'Acceptance establishes the outcome',
        provenance: 'Fictional reviewer',
        criterionIds: [w.criteria[0].id],
        reason,
      },
      f.agent,
    ) as Evidence;
    f.command(
      'workstream.review',
      { entityId: w.id, expectedVersion: f.current(w.id).version, reason },
      f.agent,
    );
    expect(f.current(w.id).status).toBe('ready_for_review');
    expect(() =>
      f.command(
        'workstream.close',
        { entityId: w.id, expectedVersion: f.current(w.id).version, evidenceIds: [e.id], reason },
        f.agent,
      ),
    ).toThrow();
    f.command('evidence.verify', {
      entityId: e.id,
      expectedVersion: e.version,
      note: 'I checked the deliverable against the agreed criterion',
      reason,
    });
    f.command(
      'workstream.close',
      { entityId: w.id, expectedVersion: f.current(w.id).version, evidenceIds: [e.id], reason },
      f.agent,
    );
    expect(f.current(w.id).status).toBe('completed');
    f.command('evidence.invalidate', {
      entityId: e.id,
      expectedVersion: f.state.evidence[0].version,
      reason: 'Earlier acceptance was incorrect',
    });
    expect(f.current(w.id).status).toBe('ready_for_review');
    expect(f.state.audit.some((a) => a.command === 'workstream.close')).toBe(true);
  });
  it('blockers retain cause, attempted resolution and unblock condition', () => {
    const f = fixture(),
      w = f.create();
    f.command(
      'workstream.block',
      {
        entityId: w.id,
        expectedVersion: w.version,
        cause: 'Source unavailable',
        attemptedResolution: 'Requested access',
        unblockCondition: 'A working access link',
        resolverId: f.thirdId,
        reason,
      },
      f.agent,
    );
    expect(f.current(w.id).blocker?.unblockCondition).toBe('A working access link');
    expect(() =>
      f.command(
        'workstream.review',
        { entityId: w.id, expectedVersion: f.current(w.id).version, reason },
        f.agent,
      ),
    ).toThrow(/blocker/);
  });
  it('E: uncertain attempts require accepted reconciliation and do not repeat sensitive actions', () => {
    const f = fixture(),
      w = f.create(),
      a = proposal(f, w);
    const standing = f.command('grant.standing', {
      workstreamId: w.id,
      expectedVersion: f.current(w.id).version,
      granteeId: f.agent.id,
      operations: ['send_email'],
      targets: ['fictional-recipient'],
      validFrom: '2026-10-01T00:00:00.000Z',
      expiresAt: future,
      maxUses: 3,
      reason,
    }) as Grant;
    let e = start(f, a, standing);
    e = f.command(
      'execution.report',
      {
        entityId: e.id,
        expectedVersion: e.version,
        state: 'uncertain',
        result: 'Provider timed out',
        reason,
      },
      f.agent,
    ) as Execution;
    expect(() => start(f, a, standing)).toThrow(/Reconcile/);
    const evidence = f.command(
      'evidence.attach',
      {
        workstreamId: w.id,
        expectedVersion: f.current(w.id).version,
        executionId: e.id,
        title: 'Provider lookup',
        description: 'Provider confirms nothing was sent',
        provenance: 'Provider lookup ID lookup-1',
        reason,
      },
      f.agent,
    ) as Evidence;
    expect(() =>
      f.command(
        'execution.reconcile',
        {
          entityId: e.id,
          expectedVersion: f.state.executions[0].version,
          state: 'failed',
          result: 'No send occurred',
          evidenceIds: [evidence.id],
          reason,
        },
        f.agent,
      ),
    ).toThrow(/accepted evidence/);
    f.command('evidence.verify', {
      entityId: evidence.id,
      expectedVersion: evidence.version,
      note: 'Checked provider lookup',
      reason,
    });
    f.command(
      'execution.reconcile',
      {
        entityId: e.id,
        expectedVersion: f.state.executions[0].version,
        state: 'failed',
        result: 'No send occurred',
        evidenceIds: [evidence.id],
        reason,
      },
      f.agent,
    );
    start(f, a, standing);
    expect(f.state.executions).toHaveLength(2);
    expect(f.state.grants[0].used).toBe(2);
  });
  it('C: recurring failures reuse an incident and keep result verification separate', () => {
    const f = fixture();
    let o = f.command('operation.create', {
      title: 'Fictional briefing',
      purpose: 'Deliver reviewed reports',
      ownerId: f.human.id,
      assignedAgentIds: [f.agent.id],
      cadenceHours: 24,
      expectedAt: future,
      reason,
    }) as Operation;
    f.agent.assignments.push(o.id);
    const g = f.command('grant.standing', {
      operationId: o.id,
      expectedVersion: o.version,
      granteeId: f.agent.id,
      operations: ['report'],
      targets: ['fictional-team'],
      validFrom: '2026-10-01T00:00:00.000Z',
      expiresAt: future,
      maxUses: 5,
      reason,
    }) as Grant;
    for (let i = 0; i < 2; i++) {
      o = f.state.operations[0];
      const e = f.command(
        'execution.start',
        {
          operationId: o.id,
          expectedVersion: o.version,
          grantId: g.id,
          operation: 'report',
          target: 'fictional-team',
          reason,
        },
        f.agent,
      ) as Execution;
      f.command(
        'execution.report',
        {
          entityId: e.id,
          expectedVersion: e.version,
          state: 'failed',
          result: 'Missing source',
          incidentKey: 'missing-source',
          reason,
        },
        f.agent,
      );
    }
    expect(f.state.workstreams).toHaveLength(1);
    expect(f.state.operations[0].incidents).toHaveLength(1);
    expect(f.state.operations[0].latestVerifiedExecutionId).toBeUndefined();
  });
  it('enforces scope, assignment removal and workspace boundaries for every mutation', () => {
    const f = fixture(),
      w = f.create();
    expect(() =>
      applyCommand(f.state, { ...f.agent, workspaceId: randomUUID() }, 'workstream.review', {
        entityId: w.id,
        expectedVersion: w.version,
        reason,
      }),
    ).toThrow(/Workspace/);
    expect(() =>
      f.command(
        'workstream.review',
        { entityId: w.id, expectedVersion: w.version, reason },
        { ...f.agent, assignments: [] },
      ),
    ).toThrow(/assignment/);
    expect(() =>
      f.command(
        'workstream.review',
        { entityId: w.id, expectedVersion: w.version, reason },
        { ...f.agent, scopes: [] },
      ),
    ).toThrow(/scope/);
    f.state.workstreams[0].assignedAgentIds = [];
    expect(visibleState(f.state, f.agent).workstreams).toHaveLength(0);
    expect(() =>
      f.command(
        'workstream.review',
        { entityId: w.id, expectedVersion: w.version, reason },
        f.agent,
      ),
    ).toThrow(/no longer assigned/);
  });
  it('conflicting external status is explicit and the owner reconciles it', () => {
    const f = fixture(),
      w = f.create(),
      id = randomUUID();
    f.command('workstream.update', {
      entityId: w.id,
      expectedVersion: w.version,
      references: [
        {
          id,
          system: 'issue tracker',
          objectId: 'FIC-1',
          responsibility: 'Implementation issue',
          reportedStatus: 'open',
        },
      ],
      reason,
    });
    const current = f.current(w.id);
    expect(() =>
      f.command(
        'workstream.update',
        {
          entityId: w.id,
          expectedVersion: current.version,
          references: [{ ...current.references[0], reportedStatus: 'closed' }],
          reason,
        },
        f.agent,
      ),
    ).toThrow(/conflicting/);
    f.command(
      'workstream.update',
      {
        entityId: w.id,
        expectedVersion: current.version,
        references: [
          {
            ...current.references[0],
            reportedStatus: 'closed',
            conflict: 'Closed externally, validation still pending',
          },
        ],
        reason,
      },
      f.agent,
    );
    expect(f.current(w.id).references[0].conflict).toBeTruthy();
  });
});
describe('safe concurrency and recovery', () => {
  it('retry results are denied after the agent assignment is removed', async () => {
    const f = fixture(),
      w = f.create(),
      repo = new MemoryRepository(f.state),
      p = { entityId: w.id, expectedVersion: w.version, reportedProgress: 'Prepared', reason };
    await execute(repo, f.agent, 'workstream.update', p, 'assignment-retry');
    repo.state.workstreams[0].assignedAgentIds = [];
    await expect(
      execute(repo, f.agent, 'workstream.update', p, 'assignment-retry'),
    ).rejects.toThrow(/no longer/);
  });
  it('new revisions cannot bypass an uncertain attempt to the same target', () => {
    const f = fixture(),
      w = f.create(),
      a = proposal(f, w),
      g = f.command('grant.standing', {
        workstreamId: w.id,
        expectedVersion: f.current(w.id).version,
        granteeId: f.agent.id,
        operations: ['send_email'],
        targets: ['fictional-recipient'],
        validFrom: '2026-10-01T00:00:00.000Z',
        expiresAt: future,
        maxUses: 5,
        reason,
      }) as Grant,
      e = start(f, a, g);
    f.command(
      'execution.report',
      { entityId: e.id, expectedVersion: e.version, state: 'uncertain', result: 'Timeout', reason },
      f.agent,
    );
    const revised = proposal(f, w, a.id);
    expect(() => start(f, revised, g)).toThrow(/Reconcile/);
  });
  it('changed criteria cannot reuse the old evidence binding', () => {
    const f = fixture(),
      w = f.create();
    expect(() =>
      f.command('workstream.update', {
        entityId: w.id,
        expectedVersion: w.version,
        criteria: [{ id: w.criteria[0].id, text: 'An entirely different acceptance requirement' }],
        reason,
      }),
    ).toThrow(/new identifiers/);
  });
  it('only one concurrent update wins and equivalent retries preserve one audit event', async () => {
    const f = fixture(),
      w = f.create(),
      repo = new MemoryRepository(f.state),
      p = { entityId: w.id, expectedVersion: w.version, reportedProgress: 'Prepared', reason };
    const outcomes = await Promise.allSettled([
      execute(repo, f.agent, 'workstream.update', p, 'parallel-a'),
      execute(
        repo,
        f.agent,
        'workstream.update',
        { ...p, reportedProgress: 'Different' },
        'parallel-b',
      ),
    ]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const winner = outcomes[0].status === 'fulfilled' ? 'parallel-a' : 'parallel-b',
      input = winner === 'parallel-a' ? p : { ...p, reportedProgress: 'Different' };
    const count = repo.state.audit.length;
    await execute(repo, f.agent, 'workstream.update', input, winner);
    expect(repo.state.audit).toHaveLength(count);
    await expect(
      execute(
        repo,
        f.agent,
        'workstream.update',
        { ...input, reportedProgress: 'Changed retry' },
        winner,
      ),
    ).rejects.toThrow(/Changed retry/);
  });
  it('scoped export excludes other work, auth IDs and credentials and restore maps the owner', () => {
    const f = fixture(),
      w = f.create();
    f.create();
    const state = scopedExport(f.state, [w.id]);
    expect(state.workstreams).toHaveLength(1);
    expect(state.identities.every((i) => !i.authUserId)).toBe(true);
    const archive = validateArchive({
        format: 'accord.v1',
        exportedAt: '2026-10-12T00:00:00.000Z',
        state,
        files: [],
      }),
      target = fixture();
    target.state.identities = target.state.identities.filter((i) => i.kind === 'human');
    const restored = prepareRestore(archive, target.state);
    expect(restored.workstreams[0].ownerId).toBe(target.human.id);
    expect(restored.audit.at(-1)?.command).toBe('workspace.restore');
    expect(restored.identities.find((i) => i.kind === 'human')?.authUserId).toBe(
      target.state.identities[0].authUserId,
    );
    expect(() => prepareRestore(archive, f.state)).toThrow(/empty/);
  });
  it('rejects corrupt or missing evidence bytes before restore', () => {
    const f = fixture(),
      w = f.create();
    f.state.evidence.push({
      id: randomUUID(),
      version: 1,
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z',
      workstreamId: w.id,
      criterionIds: [],
      title: 'File',
      description: 'Evidence',
      provenance: 'Fictional',
      submittedBy: f.agent.id,
      verification: 'unverified',
      storagePath: `${f.state.workspaceId}/${w.id}/file`,
      sha256: 'a'.repeat(64),
    });
    expect(() =>
      validateArchive({
        format: 'accord.v1',
        exportedAt: '2026-10-12T00:00:00.000Z',
        state: scopedExport(f.state, [w.id]),
        files: [],
      }),
    ).toThrow(/missing or corrupt/);
  });
});
