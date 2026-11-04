import { applyPeople, normalizePeople, peopleRecords, canReadPeople } from './people';
import { normalizeTaskLinks } from './task-links';
import { canAccess, canAccessRecord, canUseCommand, hasWorkspaceAccess } from './access';
export { canAccess } from './access';
import { minimalPerson } from './people-schema';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { schemas, type CommandName } from './commands';
import { assert, DomainError } from './errors';
import type { Actor, Entity, State, Workstream, Operation, Evidence, Grant } from './types';

type Command = { [K in CommandName]: { name: K; data: z.infer<(typeof schemas)[K]> } }[CommandName];
const terminal = new Set(['completed', 'cancelled', 'dismissed']);
export function requireAccess(actor: Actor, id: string) {
  assert(canAccess(actor, id), 'forbidden', 'This identity has no assignment to this record.', 403);
}
export function scope(actor: Actor, name: string) {
  assert(
    actor.kind === 'human' || actor.scopes.includes(name),
    'forbidden',
    `Required scope: ${name}`,
    403,
  );
}
export function find<T extends { id: string }>(records: T[], id: string): T {
  const item = records.find((r) => r.id === id);
  assert(item, 'not_found', 'Record not found.', 404);
  return item;
}
function version(item: Entity, expected: number) {
  assert(
    item.version === expected,
    'conflict',
    'Reload this record before applying your change.',
    409,
    { currentVersion: item.version },
  );
}
function mutable(w: Workstream) {
  assert(
    !terminal.has(w.status),
    'invalid_transition',
    'Reopen this outcome before making changes.',
    409,
  );
}
function future(value: string, now: string) {
  assert(Date.parse(value) > Date.parse(now), 'expired', 'Expiration must be in the future.');
}
function identity(state: State, id: string, allowed?: string[]) {
  const i = find(state.identities, id);
  assert(!allowed || allowed.includes(i.kind), 'validation', 'Identity kind is not allowed here.');
  return i;
}
function trusted(e: Evidence) {
  return e.verification !== 'unverified' && Boolean(e.verifiedBy) && Boolean(e.verifiedAt);
}

/** Pure state transition. Production commits its result with a database revision CAS. */
export function applyCommand(
  initial: State,
  actor: Actor,
  name: string,
  input: unknown,
  now = new Date().toISOString(),
): { state: State; result: Entity | { id: string } } {
  initial = normalizeTaskLinks(initial);
  assert(actor.workspaceId === initial.workspaceId, 'forbidden', 'Workspace mismatch.', 403);
  assert(name in schemas, 'unknown_command', 'Unknown command.');
  const key = name as CommandName;
  let cmd: Command;
  try {
    cmd = { name: key, data: schemas[key].parse(input) } as Command;
  } catch (e) {
    throw new DomainError(
      'validation',
      'Invalid command input.',
      400,
      e instanceof z.ZodError ? z.flattenError(e) : undefined,
    );
  }
  identity(initial, actor.id, [actor.kind]);
  scope(actor, key);
  assert(
    canUseCommand(actor, key),
    'human_required',
    'This command requires the workspace owner or an explicitly scoped workspace agent.',
    403,
  );
  const s = normalizePeople(structuredClone(initial));
  s.projects ??= [];
  s.decisions ??= [];
  s.reminders ??= [];
  const base = () => ({ id: randomUUID(), version: 1, createdAt: now, updatedAt: now });
  const touch = (e: Entity) => {
    e.version++;
    e.updatedAt = now;
  };
  const work = (id: string, expected?: number) => {
    requireAccess(actor, id);
    const w = find(s.workstreams, id);
    assert(
      canAccessRecord(actor, w),
      'forbidden',
      'Agent is no longer assigned to this outcome.',
      403,
    );
    if (expected !== undefined) version(w, expected);
    return w;
  };
  const op = (id: string, expected?: number) => {
    requireAccess(actor, id);
    const o = find(s.operations, id);
    assert(
      canAccessRecord(actor, o),
      'forbidden',
      'Agent is no longer assigned to this operation.',
      403,
    );
    if (expected !== undefined) version(o, expected);
    return o;
  };
  const parent = (e: { workstreamId?: string; operationId?: string }) =>
    e.workstreamId ? work(e.workstreamId) : op(e.operationId!);
  const agents = (ids: string[]) => {
    assert(new Set(ids).size === ids.length, 'validation', 'Duplicate agent assignment.');
    ids.forEach((id) => identity(s, id, ['agent']));
  };
  const validateWork = (w: Workstream) => {
    identity(s, w.ownerId, ['human', 'agent']);
    agents(w.assignedAgentIds);
    assert(
      w.completionPolicy === 'simple' || w.criteria.length > 0,
      'validation',
      'Verified tasks require acceptance criteria.',
    );
    if (w.projectId) find(s.projects, w.projectId);
    if (w.nextAction) identity(s, w.nextAction.ownerId);
    assert(
      new Set(w.criteria.map((c) => c.id)).size === w.criteria.length,
      'validation',
      'Duplicate criterion identifier.',
    );
  };
  const decision = (
    subjectId: string,
    subjectVersion: number,
    workstreamId: string,
    response: 'approved' | 'declined' | 'changes_requested' | 'accepted',
    feedback: string,
  ) => {
    const d = {
      ...base(),
      subjectId,
      subjectVersion,
      workstreamId,
      response,
      feedback,
      actorId: actor.id,
    };
    s.decisions.push(d);
    return d;
  };
  let result: Entity | { id: string };
  switch (cmd.name) {
    case 'profile.update': {
      assert(
        s.revision === cmd.data.expectedVersion,
        'conflict',
        'Your workspace changed. Refresh the workspace before saving your profile.',
        409,
      );
      const owner = find(s.identities, actor.id);
      owner.name = cmd.data.name;
      if (cmd.data.role) owner.role = cmd.data.role;
      else delete owner.role;
      result = owner;
      break;
    }
    default: {
      result = applyPeople(s, actor, cmd.name, cmd.data, now);
      break;
    }
    case 'project.create': {
      const { reason, ...p } = cmd.data;
      const project = { ...base(), ...p, status: 'active' as const };
      s.projects.push(project);
      result = project;
      break;
    }
    case 'project.update': {
      const { entityId, expectedVersion, reason, ...patch } = cmd.data;
      const project = find(s.projects, entityId);
      version(project, expectedVersion);
      Object.assign(project, patch);
      touch(project);
      result = project;
      break;
    }
    case 'decision.respond': {
      const p = cmd.data,
        a = s.actions.find((a) => a.id === p.entityId);
      if (a) {
        mutable(work(a.workstreamId));
        version(a, p.expectedVersion);
        assert(
          a.approvalRequested &&
            !s.actions.some((x) => x.supersedesId === a.id) &&
            !s.decisions.some((d) => d.subjectId === a.id) &&
            !s.grants.some((g) => g.actionId === a.id),
          'invalid_transition',
          'Only a pending proposal can receive this decision.',
          409,
        );
        result = decision(a.id, a.version, a.workstreamId, p.response, p.feedback);
        a.approvalRequested = false;
        touch(a);
      } else {
        const w = work(p.entityId, p.expectedVersion);
        assert(
          w.status === 'ready_for_review' && p.response === 'changes_requested',
          'invalid_transition',
          'Only a completion review can be returned for changes.',
          409,
        );
        result = decision(w.id, w.version, w.id, p.response, p.feedback);
        w.status = 'open';
        w.planningStage = 'in_progress';
        touch(w);
      }
      break;
    }
    case 'reminder.snooze': {
      const p = cmd.data;
      const subject =
        s.workstreams.find((w) => w.id === p.entityId) ??
        s.actions.find((a) => a.id === p.entityId) ??
        s.operations.find((o) => o.id === p.entityId);
      assert(subject, 'not_found', 'Reminder subject not found.', 404);
      version(subject, p.expectedVersion);
      future(p.until, now);
      let r = s.reminders.find((r) => r.subjectId === subject.id && r.actorId === actor.id);
      if (r) {
        r.subjectVersion = subject.version;
        r.until = p.until;
        touch(r);
      } else {
        r = {
          ...base(),
          subjectId: subject.id,
          subjectVersion: subject.version,
          until: p.until,
          actorId: actor.id,
        };
        s.reminders.push(r);
      }
      result = r;
      break;
    }
    case 'reminder.clear': {
      const r = find(s.reminders, cmd.data.entityId);
      version(r, cmd.data.expectedVersion);
      r.until = now;
      touch(r);
      result = r;
      break;
    }
    case 'identity.create': {
      const p = cmd.data;
      const i = { id: randomUUID(), name: p.name, kind: p.kind };
      s.identities.push(i);
      if (i.kind === 'third_party') s.people.push(minimalPerson(i.id, i.name, now));
      result = i;
      break;
    }
    case 'workstream.create': {
      const p = cmd.data;
      const w: Workstream = {
        ...base(),
        ...p,
        reviewAt: p.reviewAt ?? new Date(Date.parse(now) + 7 * 86400000).toISOString(),
        completionPolicy: p.completionPolicy ?? 'verified',
        priority: p.priority ?? 'none',
        planningStage: p.planningStage ?? 'todo',
        status: 'open',
        reportedProgress: 'No progress reported',
        verifiedAt: null,
        blocker: null,
      };
      validateWork(w);
      s.workstreams.push(w);
      result = w;
      break;
    }
    case 'workstream.update': {
      const p = cmd.data,
        w = work(p.entityId, p.expectedVersion);
      mutable(w);
      if (actor.kind !== 'human') {
        assert(
          p.completionPolicy === undefined &&
            p.criteria === undefined &&
            p.mode === undefined &&
            p.outcome === undefined,
          'human_required',
          'Outcome, completion policy, criteria, and authority mode require owner acceptance.',
          403,
        );
        if (
          p.projectId !== undefined ||
          p.ownerId !== undefined ||
          p.assignedAgentIds !== undefined
        )
          assert(
            hasWorkspaceAccess(actor) && actor.scopes.includes('workstream.manage'),
            'forbidden',
            'Workspace access and workstream.manage are required to organize tasks.',
            403,
          );
      }
      if (p.references)
        for (const old of w.references) {
          const fresh = p.references.find((r) => r.id === old.id);
          assert(
            fresh,
            'reconciliation_required',
            'References cannot be silently removed; preserve their responsibility and history.',
            409,
          );
          if (fresh.reportedStatus !== old.reportedStatus && old.reportedStatus)
            assert(
              actor.kind === 'human' || Boolean(fresh.conflict),
              'reconciliation_required',
              'Agent reports conflicting external status must describe the conflict.',
              409,
            );
          if (old.conflict && !fresh.conflict)
            assert(
              actor.kind === 'human',
              'human_required',
              'The owner reconciles external conflicts.',
              403,
            );
        }
      if (p.criteria)
        for (const criterion of p.criteria) {
          const prior = w.criteria.find((c) => c.id === criterion.id);
          assert(
            !prior || prior.text === criterion.text,
            'validation',
            'Changed criteria need new identifiers so old evidence cannot silently satisfy them.',
          );
        }
      const outcomeChanged = p.outcome !== undefined && p.outcome !== w.outcome;
      const { entityId, expectedVersion, reason, ...patch } = p;
      Object.assign(w, patch);
      validateWork(w);
      if (outcomeChanged) {
        w.verifiedAt = null;
        for (const e of s.evidence.filter((e) => e.workstreamId === w.id && trusted(e))) {
          e.verification = 'unverified';
          delete e.verifiedAt;
          delete e.verifiedBy;
          e.verificationNote = 'Outcome changed; evidence requires fresh acceptance.';
          touch(e);
        }
      }
      touch(w);
      result = w;
      break;
    }
    case 'workstream.block': {
      const p = cmd.data,
        w = work(p.entityId, p.expectedVersion);
      mutable(w);
      identity(s, p.resolverId);
      w.blocker = {
        cause: p.cause,
        attemptedResolution: p.attemptedResolution,
        unblockCondition: p.unblockCondition,
        resolverId: p.resolverId,
      };
      w.status = 'blocked';
      touch(w);
      result = w;
      break;
    }
    case 'workstream.unblock': {
      const p = cmd.data,
        w = work(p.entityId, p.expectedVersion);
      assert(
        w.status === 'blocked',
        'invalid_transition',
        'Only blocked outcomes can be unblocked.',
        409,
      );
      w.blocker = null;
      w.status = 'open';
      touch(w);
      result = w;
      break;
    }
    case 'workstream.review': {
      const p = cmd.data,
        w = work(p.entityId, p.expectedVersion);
      mutable(w);
      assert(!w.blocker, 'blocked', 'Resolve the blocker before submitting for review.', 409);
      w.status = 'ready_for_review';
      touch(w);
      result = w;
      break;
    }
    case 'workstream.close': {
      const p = cmd.data,
        w = work(p.entityId, p.expectedVersion);
      assert(
        !s.commitments.some(
          (c) =>
            c.workstreamId === cmd.data.entityId &&
            c.required &&
            !['fulfilled', 'waived'].includes(c.status),
        ),
        'invalid_transition',
        'Fulfill or waive required commitments before completing this task.',
        409,
      );
      mutable(w);
      assert(!w.blocker, 'blocked', 'Resolve the blocker before closing.', 409);
      assert(
        !s.executions.some(
          (e) => e.workstreamId === w.id && (e.state === 'uncertain' || e.state === 'running'),
        ),
        'reconciliation_required',
        'Resolve running or uncertain executions before closure.',
        409,
      );
      assert(
        !w.references.some((r) => r.conflict),
        'reconciliation_required',
        'Reconcile external status conflicts before closure.',
        409,
      );
      const evidence = p.evidenceIds.map((id) => find(s.evidence, id));
      assert(
        evidence.every((e) => e.workstreamId === w.id),
        'validation',
        'Closure evidence must belong to this outcome.',
      );
      if (w.completionPolicy === 'simple') {
        assert(
          actor.kind === 'human' ||
            (actor.kind === 'agent' &&
              (hasWorkspaceAccess(actor) || (actor.id === w.ownerId && canAccessRecord(actor, w)))),
          'forbidden',
          'Completion requires the workspace owner, assigned task owner, or a scoped workspace agent.',
          403,
        );
      } else if (actor.kind !== 'human') {
        assert(
          actor.kind === 'agent' && canAccessRecord(actor, w),
          'forbidden',
          'Only authorized agents can close this outcome.',
          403,
        );
        assert(
          w.criteria.every((c) =>
            evidence.some((e) => e.criterionIds.includes(c.id) && trusted(e)),
          ),
          'insufficient_evidence',
          'Each closure criterion needs human-accepted or independently verified evidence.',
          409,
        );
      } else {
        assert(
          Boolean(p.humanConfirmation) ||
            w.criteria.every((c) =>
              evidence.some((e) => e.criterionIds.includes(c.id) && trusted(e)),
            ),
          'insufficient_evidence',
          'Accept each criterion through evidence or record an explicit attributable confirmation.',
          409,
        );
      }
      if (w.status === 'ready_for_review' && actor.kind === 'human')
        decision(w.id, w.version, w.id, 'accepted', p.humanConfirmation ?? p.reason);
      w.status = 'completed';
      w.verifiedAt = w.completionPolicy === 'simple' ? null : now;
      w.nextAction = null;
      w.closure = {
        reason: p.humanConfirmation ?? p.reason,
        actorId: actor.id,
        evidenceIds: p.evidenceIds,
        at: now,
      };
      touch(w);
      result = w;
      break;
    }
    case 'workstream.terminate': {
      const p = cmd.data,
        w = work(p.entityId, p.expectedVersion);
      mutable(w);
      w.status = p.disposition;
      w.nextAction = null;
      w.closure = { reason: p.reason, actorId: actor.id, evidenceIds: [], at: now };
      touch(w);
      result = w;
      break;
    }
    case 'workstream.reopen': {
      const p = cmd.data,
        w = work(p.entityId, p.expectedVersion);
      assert(
        terminal.has(w.status),
        'invalid_transition',
        'Only terminal outcomes can be reopened.',
        409,
      );
      w.status = 'open';
      w.verifiedAt = null;
      delete w.closure;
      touch(w);
      result = w;
      break;
    }
    case 'action.propose': {
      const p = cmd.data,
        w = work(p.workstreamId, p.expectedVersion);
      mutable(w);
      future(p.expiresAt, now);
      let revision = 1;
      if (p.supersedesId) {
        const previous = find(s.actions, p.supersedesId);
        assert(
          previous.workstreamId === w.id,
          'validation',
          'Revision must belong to the same outcome.',
        );
        assert(
          !s.actions.some((a) => a.supersedesId === previous.id),
          'conflict',
          'This revision has already been superseded.',
          409,
        );
        revision = previous.revision + 1;
      }
      const a = { ...base(), ...p, revision, approvalRequested: false };
      s.actions.push(a);
      touch(w);
      result = a;
      break;
    }
    case 'action.request_approval': {
      const p = cmd.data,
        a = find(s.actions, p.entityId);
      mutable(work(a.workstreamId));
      version(a, p.expectedVersion);
      assert(
        !s.actions.some((x) => x.supersedesId === a.id),
        'superseded',
        'Request approval on the latest revision.',
        409,
      );
      assert(
        !s.decisions.some((d) => d.subjectId === a.id),
        'invalid_transition',
        'Create a new proposal revision after a decision.',
        409,
      );
      future(a.expiresAt, now);
      a.approvalRequested = true;
      touch(a);
      result = a;
      break;
    }
    case 'grant.approve': {
      const p = cmd.data,
        a = find(s.actions, p.entityId);
      mutable(work(a.workstreamId));
      version(a, p.expectedVersion);
      future(a.expiresAt, now);
      identity(s, p.granteeId, ['human', 'agent']);
      assert(
        a.approvalRequested,
        'invalid_transition',
        'Request approval before granting authority.',
        409,
      );
      assert(
        !s.actions.some((x) => x.supersedesId === a.id),
        'superseded',
        'Approve the latest content revision.',
        409,
      );
      assert(
        !s.grants.some((g) => g.actionId === a.id && !g.revokedAt),
        'already_approved',
        'Revoke the existing grant before issuing another.',
        409,
      );
      const g: Grant = {
        ...base(),
        type: 'one_time',
        actionId: a.id,
        workstreamId: a.workstreamId,
        operations: [a.operation],
        targets: [a.target],
        granteeId: p.granteeId,
        validFrom: now,
        expiresAt: a.expiresAt,
        maxUses: 1,
        used: 0,
        costLimit: a.declaredCost,
        declaredCostUsed: 0,
        currency: a.currency,
        revokedAt: null,
        approvedBy: actor.id,
      };
      assert(
        !s.decisions.some((d) => d.subjectId === a.id && d.response !== 'approved'),
        'invalid_transition',
        'This proposal needs a new revision.',
        409,
      );
      decision(a.id, a.version, a.workstreamId, 'approved', p.reason);
      s.grants.push(g);
      touch(a);
      result = g;
      break;
    }
    case 'grant.standing': {
      const p = cmd.data;
      const owner = p.workstreamId
        ? work(p.workstreamId, p.expectedVersion)
        : op(p.operationId!, p.expectedVersion);
      if (p.workstreamId) mutable(owner as Workstream);
      future(p.expiresAt, now);
      assert(
        Date.parse(p.validFrom) < Date.parse(p.expiresAt),
        'validation',
        'Validity interval is empty.',
      );
      identity(s, p.granteeId, ['human', 'agent']);
      const g: Grant = {
        ...base(),
        ...p,
        type: 'standing',
        used: 0,
        declaredCostUsed: 0,
        revokedAt: null,
        approvedBy: actor.id,
      };
      s.grants.push(g);
      if (p.operationId) (owner as Operation).grantId = g.id;
      touch(owner);
      result = g;
      break;
    }
    case 'grant.revoke': {
      const p = cmd.data,
        g = find(s.grants, p.entityId);
      parent(g);
      version(g, p.expectedVersion);
      g.revokedAt = now;
      touch(g);
      result = g;
      break;
    }
    case 'execution.start': {
      const p = cmd.data,
        a = p.actionId ? find(s.actions, p.actionId) : undefined,
        o = p.operationId ? op(p.operationId, p.expectedVersion) : undefined;
      if (a) {
        mutable(work(a.workstreamId));
        version(a, p.expectedVersion);
        future(a.expiresAt, now);
        assert(
          !s.actions.some((x) => x.supersedesId === a.id),
          'superseded',
          'Execute the latest revision.',
          409,
        );
      }
      const g = find(s.grants, p.grantId);
      const parentId = a?.workstreamId ?? o!.id;
      assert(
        (a && g.workstreamId === parentId) || (!a && g.operationId === parentId),
        'forbidden',
        'Grant belongs to a different outcome or operation.',
        403,
      );
      assert(g.granteeId === actor.id, 'forbidden', 'This grant belongs to another identity.', 403);
      assert(
        !g.revokedAt &&
          Date.parse(g.validFrom) <= Date.parse(now) &&
          Date.parse(g.expiresAt) > Date.parse(now),
        'authority_unavailable',
        'Authority is revoked, not yet valid, or expired.',
        403,
      );
      assert(g.used < g.maxUses, 'authority_exhausted', 'Usage limit has been reached.', 409);
      if (g.type === 'one_time')
        assert(
          g.actionId === a?.id,
          'scope_changed',
          'Approval is bound to a different content revision.',
          403,
        );
      const operation = a?.operation ?? p.operation,
        target = a?.target ?? p.target;
      assert(
        operation && target && g.operations.includes(operation) && g.targets.includes(target),
        'scope_changed',
        'Operation or target is outside this grant.',
        403,
      );
      const cost = a?.declaredCost ?? p.declaredCost,
        currency = a?.currency ?? p.currency;
      assert(
        currency === g.currency,
        'scope_changed',
        'Currency differs from approved scope.',
        403,
      );
      assert(
        g.costLimit === undefined || g.declaredCostUsed + cost <= g.costLimit,
        'budget_exhausted',
        'Declared cost limit would be exceeded.',
        409,
      );
      assert(
        !s.executions.some((e) => {
          if (e.state !== 'running' && e.state !== 'uncertain') return false;
          if (!a) return e.operationId === o!.id;
          const previous = s.actions.find((x) => x.id === e.actionId);
          return (
            previous?.workstreamId === a.workstreamId &&
            previous.operation === a.operation &&
            previous.target === a.target
          );
        }),
        'reconciliation_required',
        'Reconcile the existing attempt before another execution.',
        409,
      );
      g.used++;
      g.declaredCostUsed += cost;
      touch(g);
      const e = {
        ...base(),
        actionId: a?.id,
        operationId: o?.id,
        workstreamId: a?.workstreamId,
        grantId: g.id,
        actorId: actor.id,
        state: 'running' as const,
        result: 'Attempt started; result not yet observed',
        evidenceIds: [],
      };
      s.executions.push(e);
      if (a) touch(a);
      if (o) {
        o.latestExecutionId = e.id;
        touch(o);
      }
      result = e;
      break;
    }
    case 'execution.report': {
      const p = cmd.data,
        e = find(s.executions, p.entityId);
      parent(e);
      version(e, p.expectedVersion);
      assert(
        actor.kind === 'human' || e.actorId === actor.id,
        'forbidden',
        'Only the attempt owner can report its result.',
        403,
      );
      assert(
        e.state === 'running',
        'invalid_transition',
        'An observed result cannot be replaced; reconcile uncertainty or append evidence/correction.',
        409,
      );
      e.state = p.state;
      e.result = p.result;
      e.externalId = p.externalId;
      delete e.verifiedAt;
      if (e.operationId) {
        const o = op(e.operationId);
        o.expectedAt = new Date(Date.parse(now) + o.cadenceHours * 3600000).toISOString();
        if (p.state !== 'succeeded') {
          assert(
            p.incidentKey,
            'validation',
            'A failed, partial, or uncertain operation needs an incident key.',
          );
          let incident = o.incidents.find((i) => i.key === p.incidentKey);
          if (!incident) {
            const w: Workstream = {
              ...base(),
              title: `Incident: ${o.title}`,
              outcome: `Restore ${o.purpose}`,
              ownerId: o.ownerId,
              assignedAgentIds: o.assignedAgentIds,
              mode: 'assisted',
              criteria: [{ id: randomUUID(), text: 'Operation recovery has been verified' }],
              nextAction: { text: 'Investigate and restore the operation', ownerId: e.actorId },
              status: 'open',
              reviewAt: now,
              reportedProgress: p.result,
              verifiedAt: null,
              blocker: null,
              references: [],
              links: [],
            };
            s.workstreams.push(w);
            incident = { key: p.incidentKey!, workstreamId: w.id };
            o.incidents.push(incident);
          }
          e.incidentKey = p.incidentKey;
        }
        touch(o);
      }
      touch(e);
      result = e;
      break;
    }
    case 'execution.reconcile': {
      const p = cmd.data,
        e = find(s.executions, p.entityId);
      parent(e);
      version(e, p.expectedVersion);
      assert(
        e.state === 'uncertain' || e.state === 'running',
        'invalid_transition',
        'Only uncertain or interrupted running attempts need reconciliation.',
        409,
      );
      const evidence = p.evidenceIds.map((id) => find(s.evidence, id));
      assert(
        evidence.every((x) => x.executionId === e.id && trusted(x)),
        'insufficient_evidence',
        'Reconciliation requires accepted evidence tied to this attempt.',
        409,
      );
      e.state = p.state;
      e.result = p.result;
      e.externalId = p.externalId;
      e.reconciledAt = now;
      e.verifiedAt = now;
      e.reconciliation = p.reason;
      e.evidenceIds = p.evidenceIds;
      touch(e);
      result = e;
      break;
    }
    case 'evidence.attach': {
      const p = cmd.data,
        owner = p.workstreamId
          ? work(p.workstreamId, p.expectedVersion)
          : op(p.operationId!, p.expectedVersion);
      if (p.workstreamId)
        assert(
          p.criterionIds.every((id) => (owner as Workstream).criteria.some((c) => c.id === id)),
          'validation',
          'Unknown closure criterion.',
        );
      if (p.executionId) {
        const e = find(s.executions, p.executionId);
        assert(
          e.workstreamId === p.workstreamId && e.operationId === p.operationId,
          'validation',
          'Evidence and execution belong to different records.',
        );
      }
      if (p.storagePath)
        assert(
          p.storagePath.startsWith(`${s.workspaceId}/${owner.id}/`) && p.sha256,
          'validation',
          'Files need an authorized object path and checksum.',
        );
      const e: Evidence = { ...base(), ...p, submittedBy: actor.id, verification: 'unverified' };
      s.evidence.push(e);
      touch(owner);
      if (p.executionId) {
        const execution = find(s.executions, p.executionId);
        execution.evidenceIds.push(e.id);
        touch(execution);
      }
      result = e;
      break;
    }
    case 'evidence.verify': {
      const p = cmd.data,
        e = find(s.evidence, p.entityId),
        owner = parent(e);
      version(e, p.expectedVersion);
      assert(
        actor.kind === 'human' || actor.kind === 'integration',
        'human_required',
        'Agents cannot verify their own or another agent’s evidence.',
        403,
      );
      assert(
        actor.kind === 'human' ||
          (actor.id !== e.submittedBy &&
            actor.id !== s.executions.find((x) => x.id === e.executionId)?.actorId),
        'self_verification',
        'Independent verifiers cannot verify their own execution.',
        403,
      );
      e.verification = actor.kind === 'human' ? 'accepted' : 'independent';
      e.verifiedBy = actor.id;
      e.verifiedAt = now;
      e.verificationNote = p.note;
      touch(e);
      if (e.workstreamId) {
        (owner as Workstream).verifiedAt = now;
        touch(owner);
      }
      if (e.executionId) {
        const execution = find(s.executions, e.executionId);
        execution.verifiedAt = now;
        touch(execution);
        if (e.operationId && execution.state === 'succeeded') {
          (owner as Operation).latestVerifiedExecutionId = execution.id;
          touch(owner);
        }
      }
      result = e;
      break;
    }
    case 'evidence.invalidate': {
      const p = cmd.data,
        e = find(s.evidence, p.entityId),
        owner = parent(e);
      version(e, p.expectedVersion);
      e.verification = 'unverified';
      delete e.verifiedAt;
      delete e.verifiedBy;
      e.verificationNote = p.reason;
      touch(e);
      if (e.workstreamId) {
        const w = owner as Workstream;
        w.verifiedAt = null;
        if (w.status === 'completed' && w.completionPolicy !== 'simple') {
          w.status = 'ready_for_review';
          delete w.closure;
        }
        touch(w);
      }
      if (e.executionId) {
        const execution = find(s.executions, e.executionId);
        delete execution.verifiedAt;
        touch(execution);
        if (e.operationId && (owner as Operation).latestVerifiedExecutionId === execution.id) {
          delete (owner as Operation).latestVerifiedExecutionId;
          touch(owner);
        }
      }
      result = e;
      break;
    }
    case 'operation.create': {
      const p = cmd.data;
      identity(s, p.ownerId, ['human', 'agent']);
      agents(p.assignedAgentIds);
      const o: Operation = { ...base(), ...p, incidents: [] };
      s.operations.push(o);
      result = o;
      break;
    }
    case 'operation.update': {
      const p = cmd.data,
        o = op(p.entityId, p.expectedVersion);
      if (p.assignedAgentIds) agents(p.assignedAgentIds);
      const { entityId, expectedVersion, reason, ...patch } = p;
      Object.assign(o, patch);
      touch(o);
      result = o;
      break;
    }
  }
  // Evidence, attempts and feedback can change the decision context without
  // changing a task's own version. Never keep a now-material reminder hidden.
  if (!key.startsWith('reminder.')) {
    const changedParents = new Set<string>();
    for (const record of [
      ...s.actions,
      ...s.executions,
      ...s.evidence,
      ...s.grants,
      ...s.decisions,
    ]) {
      if (JSON.stringify(entitySnapshot(initial, record.id)) !== JSON.stringify(record)) {
        if (record.workstreamId) changedParents.add(record.workstreamId);
        if ('operationId' in record && record.operationId) changedParents.add(record.operationId);
      }
    }
    for (const r of s.reminders) {
      const parentId = s.actions.find((a) => a.id === r.subjectId)?.workstreamId ?? r.subjectId;
      if (changedParents.has(parentId) && Date.parse(r.until) > Date.parse(now)) {
        r.until = now;
        touch(r);
      }
    }
  }
  const peopleAfter = new Set(peopleRecords(s));
  const peopleBefore = new Map(peopleRecords(initial).map((p) => [p.id, p]));
  // Every changed record gets an event, including consumed authority, changed
  // parents, and deduplicated incident creation. Technical tool calls do not.
  for (const record of [
    ...s.workstreams,
    ...s.actions,
    ...s.grants,
    ...s.executions,
    ...s.evidence,
    ...s.operations,
    ...s.identities,
    ...s.projects,
    ...s.decisions,
    ...s.reminders,
    ...peopleRecords(s),
  ]) {
    const before = peopleAfter.has(record as Entity)
      ? (peopleBefore.get(record.id) ?? null)
      : entitySnapshot(initial, record.id);
    if (JSON.stringify(before) !== JSON.stringify(record))
      s.audit.push({
        id: randomUUID(),
        actorId: actor.id,
        at: now,
        command: key,
        entityId: record.id,
        reason: cmd.data.reason,
        changes: { before: structuredClone(before), after: structuredClone(record) },
      });
  }
  s.revision++;
  return { state: s, result };
}
function entitySnapshot(s: State, id: string) {
  return (
    [
      ...s.workstreams,
      ...s.actions,
      ...s.grants,
      ...s.executions,
      ...s.evidence,
      ...s.operations,
      ...s.identities,
      ...(s.projects ?? []),
      ...(s.decisions ?? []),
      ...(s.reminders ?? []),
      ...peopleRecords(s),
    ].find((e) => e.id === id) ?? null
  );
}

export function visibleState(s: State, actor: Actor): State {
  s = normalizeTaskLinks(s);
  assert(s.workspaceId === actor.workspaceId, 'forbidden', 'Workspace mismatch.', 403);
  assert(
    actor.kind === 'human' || actor.scopes.includes('read') || canReadPeople(actor),
    'forbidden',
    'Read permission is required.',
    403,
  );
  if (actor.kind === 'human') return s;
  const workstreams = (actor.scopes.includes('read') ? s.workstreams : []).filter((w) =>
    canAccessRecord(actor, w),
  );
  const operations = (actor.scopes.includes('read') ? s.operations : []).filter((o) =>
    canAccessRecord(actor, o),
  );
  const parentIds = new Set([...workstreams, ...operations].map((x) => x.id));
  const allowed = (e: { workstreamId?: string; operationId?: string }) =>
    parentIds.has(e.workstreamId ?? e.operationId ?? '');
  const actions = s.actions.filter(allowed),
    grants = s.grants.filter((g) => allowed(g) && g.granteeId === actor.id),
    executions = s.executions.filter(allowed),
    evidence = s.evidence.filter(allowed);
  const projects = (s.projects ?? []).filter(
    (p) =>
      (hasWorkspaceAccess(actor) && actor.scopes.includes('read')) ||
      workstreams.some((w) => w.projectId === p.id),
  );
  const decisions = (s.decisions ?? []).filter((d) => parentIds.has(d.workstreamId));
  const recordIds = new Set(
    [
      ...workstreams,
      ...(hasWorkspaceAccess(actor) ? projects : []),
      ...operations,
      ...actions,
      ...grants,
      ...executions,
      ...evidence,
      ...decisions,
    ].map((x) => x.id),
  );
  const identityIds = new Set([
    actor.id,
    ...workstreams.flatMap((w) => [
      w.ownerId,
      ...w.assignedAgentIds,
      w.nextAction?.ownerId ?? '',
      w.blocker?.resolverId ?? '',
    ]),
    ...operations.flatMap((o) => [o.ownerId, ...o.assignedAgentIds]),
  ]);
  const peopleAccess = canReadPeople(actor);
  const peopleData = Object.fromEntries(
    [
      'people',
      'relationshipGroups',
      'interactions',
      'importantDates',
      'commitments',
      'peopleResponses',
    ].map((k) => [k, peopleAccess ? (s[k as keyof State] ?? []) : []]),
  );
  if (peopleAccess) {
    for (const p of s.people ?? []) identityIds.add(p.id);
    for (const i of s.identities) if (i.kind === 'human') identityIds.add(i.id);
    for (const c of s.commitments ?? []) identityIds.add(c.coordinatorId);
  }
  const peopleIds = new Set(peopleAccess ? peopleRecords(s).map((e) => e.id) : []);
  const safeCommitments = peopleAccess
    ? (s.commitments ?? []).map((c) => ({
        ...c,
        workstreamId: parentIds.has(c.workstreamId ?? '') ? c.workstreamId : null,
        projectId: projects.some((p) => p.id === c.projectId) ? c.projectId : null,
      }))
    : [];
  return {
    ...s,
    ...peopleData,
    commitments: safeCommitments,
    projects,
    decisions,
    reminders: [],
    workstreams,
    operations,
    actions,
    grants,
    executions,
    evidence,
    identities: s.identities.filter((i) => identityIds.has(i.id)).map(({ authUserId, ...i }) => i),
    audit: s.audit
      .filter((a) => recordIds.has(a.entityId) || peopleIds.has(a.entityId))
      .map((a) => (peopleIds.has(a.entityId) ? { ...a, changes: { redacted: true } } : a)),
  };
}
export { attention } from './presentation';
