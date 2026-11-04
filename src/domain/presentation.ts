import { peopleQueue, localDate, type PeopleQueueItem } from './people-presentation';
import type { State, Workstream, Operation } from './types';
export function attention(w: Workstream, s: State) {
  if (['completed', 'cancelled', 'dismissed'].includes(w.status)) return w.status;
  if (w.status === 'blocked') return 'blocked';
  if (w.status === 'ready_for_review') return 'ready for review';
  if (!w.nextAction) return 'missing next action';
  const owner = s.identities.find((i) => i.id === w.nextAction!.ownerId);
  if (owner?.kind === 'third_party') return 'waiting externally';
  if (owner?.kind === 'human') return 'needs my attention';
  return 'agent working';
}
export function operationHealth(o: Operation, s: State, now = Date.now()) {
  const latest = s.executions.find((e) => e.id === o.latestExecutionId);
  if (!latest) return 'No execution reported';
  if (latest.state === 'uncertain') return 'Uncertain · reconcile';
  if (latest.state === 'failed') return 'Failed · attention needed';
  if (latest.state === 'partial') return 'Partial · attention needed';
  if (latest.state === 'running') return 'Attempt in progress';
  if (Date.parse(o.expectedAt) < now) return 'Execution overdue';
  if (o.latestVerifiedExecutionId !== latest.id) return 'Success reported · unverified';
  return 'Latest result verified';
}

export interface QueueItem {
  id: string;
  kind: 'approval' | 'review' | 'blocker' | 'followup' | 'incident' | 'people';
  peopleItems?: PeopleQueueItem[];
  subjectId: string;
  version: number;
  taskId?: string;
  operationId?: string;
  title: string;
  reasons: string[];
  ownerId: string;
  at: string;
  rank: number;
  priority: number;
  reminderId?: string;
  snoozedUntil?: string;
  dueDate?: string;
  nextStep?: string;
}
const priorityRank = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
export type TodayAudience = 'needs-me' | 'agent' | 'monitoring';
/** Responsibility is separate from urgency: a due date is not a human handoff. */
export function todayAudience(item: QueueItem, s: State): TodayAudience {
  const identityKind = (id?: string) => s.identities.find((i) => i.id === id)?.kind;
  const task = s.workstreams.find((w) => w.id === item.taskId);
  if (item.kind === 'approval' || task?.status === 'ready_for_review') return 'needs-me';
  // A linked personal reminder remains actionable even while an agent works on the task.
  if (item.peopleItems?.some((p) => !p.snoozedUntil && identityKind(p.ownerId) === 'human'))
    return 'needs-me';
  if (item.operationId) return 'monitoring';
  if (task) {
    const responsible = task.blocker?.resolverId ?? task.nextAction?.ownerId ?? task.ownerId;
    const kind = identityKind(responsible);
    if (kind === 'human' && (task.blocker || task.nextAction)) return 'needs-me';
    if (item.kind === 'incident') return 'monitoring';
    // Review reminders schedule a check-in; they do not reassign the next step.
    if (item.reasons.every((r) => r === 'Review reminder due')) return 'monitoring';
    if (kind === 'human') return 'needs-me';
    return kind === 'agent' || kind === 'integration' ? 'agent' : 'monitoring';
  }
  const kind = identityKind(item.ownerId);
  return kind === 'human'
    ? 'needs-me'
    : kind === 'agent' || kind === 'integration'
      ? 'agent'
      : 'monitoring';
}
export const todayFilters = [
  { value: 'needs-me', label: 'Needs me' },
  { value: 'agent', label: 'Agent work' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'all', label: 'All' },
  { value: 'approval', label: 'Approvals' },
  { value: 'review', label: 'Reviews' },
  { value: 'blocker', label: 'Blockers' },
  { value: 'followup', label: 'Follow-ups' },
  { value: 'people', label: 'People' },
  { value: 'snoozed', label: 'Snoozed' },
] as const;
export type TodayFilter = (typeof todayFilters)[number]['value'];
export function todayFilter(value: string | null): TodayFilter {
  return todayFilters.find((f) => f.value === value)?.value ?? 'needs-me';
}
export function filterTodayQueue(items: QueueItem[], s: State, filter: TodayFilter): QueueItem[] {
  return items.filter((item) => {
    if (filter === 'snoozed') return Boolean(item.snoozedUntil);
    if (item.snoozedUntil) return false;
    if (filter === 'all') return true;
    const audience = todayAudience(item, s);
    if (filter === 'needs-me' || filter === 'agent' || filter === 'monitoring')
      return audience === filter;
    // Category shortcuts refine the personal queue, rather than mixing agent work back in.
    if (audience !== 'needs-me') return false;
    if (filter === 'people') return Boolean(item.peopleItems?.length);
    if (filter === 'followup') return ['followup', 'incident'].includes(item.kind);
    return item.kind === filter;
  });
}
/** Pure queue projection, shared by UI tests and available to future clients. */
export function decisionQueue(s: State, now = Date.now()): QueueItem[] {
  const active = s.workstreams.filter(
    (w) => !['completed', 'cancelled', 'dismissed'].includes(w.status),
  );
  const result: QueueItem[] = [];
  for (const w of active) {
    const failures = s.executions.filter(
      (e) =>
        e.workstreamId === w.id &&
        (e.state === 'uncertain' || e.state === 'failed' || e.state === 'partial') &&
        !e.reconciledAt &&
        !e.verifiedAt,
    );
    const reasons: string[] = [];
    if (failures.length)
      reasons.push(
        failures.some((e) => e.state === 'uncertain')
          ? 'An execution needs reconciliation'
          : 'An execution needs attention',
      );
    if (w.references.some((r) => r.conflict)) reasons.push('Conflicting source information');
    if (w.status === 'ready_for_review') reasons.push('Result ready for your review');
    if (w.blocker) reasons.push(w.blocker.cause);
    if (w.dueDate && w.dueDate <= localDate(now, s.timezone)) reasons.push('Task due');
    if (Date.parse(w.reviewAt) <= now) reasons.push('Review reminder due');
    if (!w.nextAction && w.completionPolicy !== 'simple') reasons.push('Next step needed');
    if (
      w.nextAction &&
      s.identities.some((i) => i.id === w.nextAction!.ownerId && i.kind === 'human')
    )
      reasons.push('Your next step');
    if (reasons.length) {
      const kind =
        failures.length || w.references.some((r) => r.conflict)
          ? 'incident'
          : w.status === 'ready_for_review'
            ? 'review'
            : w.blocker
              ? 'blocker'
              : 'followup';
      result.push({
        id: `task:${w.id}`,
        subjectId: w.id,
        version: w.version,
        taskId: w.id,
        kind,
        title: w.title,
        reasons,
        ownerId: w.blocker?.resolverId ?? w.nextAction?.ownerId ?? w.ownerId,
        at: w.updatedAt,
        rank: kind === 'incident' ? 0 : kind === 'review' ? 1 : kind === 'blocker' ? 2 : 3,
        priority: priorityRank[w.priority ?? 'none'],
        dueDate: w.dueDate ?? undefined,
        nextStep: w.nextAction?.text,
      });
    }
    for (const a of s.actions.filter(
      (a) =>
        a.workstreamId === w.id &&
        a.approvalRequested &&
        !s.actions.some((x) => x.supersedesId === a.id) &&
        !(s.decisions ?? []).some((d) => d.subjectId === a.id) &&
        !s.grants.some((g) => g.actionId === a.id),
    )) {
      result.push({
        id: `action:${a.id}`,
        subjectId: a.id,
        version: a.version,
        taskId: w.id,
        kind: 'approval',
        title: a.effect,
        reasons: [
          Date.parse(a.expiresAt) <= now
            ? 'Proposal expired · request a new revision'
            : 'Approval requested',
        ],
        ownerId: w.ownerId,
        at: a.updatedAt,
        rank: 1,
        priority: priorityRank[w.priority ?? 'none'],
      });
    }
  }
  for (const o of s.operations) {
    const e = s.executions.find((e) => e.id === o.latestExecutionId);
    const health = operationHealth(o, s, now);
    if (
      !e ||
      (['uncertain', 'failed', 'partial'].includes(e.state) && !e.reconciledAt && !e.verifiedAt) ||
      Date.parse(o.expectedAt) <= now ||
      o.latestVerifiedExecutionId !== o.latestExecutionId
    )
      result.push({
        id: `routine:${o.id}`,
        subjectId: o.id,
        version: o.version,
        operationId: o.id,
        kind: e && ['uncertain', 'failed', 'partial'].includes(e.state) ? 'incident' : 'followup',
        title: o.title,
        reasons: [health],
        ownerId: o.ownerId,
        at: o.updatedAt,
        rank: e && ['uncertain', 'failed', 'partial'].includes(e.state) ? 0 : 3,
        priority: 0,
      });
  }
  for (const item of peopleQueue(s, now)) {
    const task = item.taskId ? s.workstreams.find((w) => w.id === item.taskId) : undefined;
    // Closing a task also removes its linked reminders from Today.
    if (task && ['completed', 'cancelled', 'dismissed'].includes(task.status)) continue;
    const existing = task ? result.find((q) => q.id === `task:${task.id}`) : undefined;
    if (existing) {
      existing.peopleItems ??= [];
      existing.peopleItems.push(item);
      if (!item.snoozedUntil)
        existing.reasons.push(...item.reasons.map((r) => `${item.title}: ${r}`));
    } else if (task) {
      result.push({
        id: `task:${task.id}`,
        subjectId: task.id,
        version: task.version,
        taskId: task.id,
        kind: 'people',
        title: task.title,
        reasons: [...item.reasons],
        ownerId: task.ownerId,
        at: item.at,
        rank: 3,
        priority: item.priority,
        peopleItems: [item],
      });
    } else {
      result.push({
        id: item.id,
        subjectId: item.subjectId,
        version: item.version,
        kind: 'people',
        title: item.title,
        reasons: [...item.reasons],
        ownerId: item.ownerId,
        at: item.at,
        rank: 3,
        priority: item.priority,
        peopleItems: [item],
      });
    }
  }
  return result
    .map((item) => {
      const r = (s.reminders ?? []).find(
        (r) =>
          r.subjectId === item.subjectId &&
          r.subjectVersion === item.version &&
          Date.parse(r.until) > now,
      );
      const people = item.peopleItems ?? [];
      const peopleSnooze =
        item.kind === 'people' && people.length && people.every((p) => p.snoozedUntil)
          ? people.map((p) => p.snoozedUntil!).sort()[0]
          : undefined;
      const activePeople = people.some((p) => !p.snoozedUntil);
      return {
        ...item,
        reminderId: r?.id,
        snoozedUntil: activePeople ? undefined : (r?.until ?? peopleSnooze),
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.priority - a.priority ||
        Date.parse(a.at) - Date.parse(b.at) ||
        a.id.localeCompare(b.id),
    );
}
