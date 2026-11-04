import type { Audit, State } from './types';
import { localDate } from './people-presentation';

type Fields = Record<string, unknown>;
export function fields(value: unknown): Fields {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : {};
}
// Never put authentication material in the inspector, including restored legacy records.
export function inspectable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inspectable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(authUserId|token|tokenHash|token_hash|access_token|refresh_token|authorization|password|secret)$/i.test(
              key,
            ),
        )
        .map(([key, v]) => [key, inspectable(v)]),
    );
  return value;
}
export function activityChanges(event: Audit) {
  const changes = fields(inspectable(event.changes));
  const before = fields(changes.before),
    after = fields(changes.after);
  if (changes.redacted) return [];
  if (!('before' in changes || 'after' in changes))
    return Object.entries(changes).map(([key, after]) => ({ key, before: undefined, after }));
  if (
    (changes.before !== null &&
      typeof changes.before !== 'object' &&
      changes.before !== undefined) ||
    (changes.after !== null && typeof changes.after !== 'object' && changes.after !== undefined)
  )
    return [
      {
        key: event.command === 'workspace.timezone' ? 'timezone' : 'value',
        before: changes.before,
        after: changes.after,
      },
    ];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !['id', 'version', 'createdAt', 'updatedAt'].includes(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, before: before[key], after: after[key] }));
}
export const activityOutcomes: Record<string, string> = {
  recorded: 'Change saved',
  running: 'Execution started',
  succeeded: 'Reported success',
  partial: 'Reported partial',
  failed: 'Reported failure',
  uncertain: 'Outcome uncertain',
};
export function activityEntries(state: State) {
  const identities = new Map(state.identities.map((i) => [i.id, i]));
  const destinations = new Map(
    [
      ...state.workstreams.map((r) => ({ id: r.id, label: r.title, href: `/tasks/${r.id}` })),
      ...state.operations.map((r) => ({ id: r.id, label: r.title, href: `/routines/${r.id}` })),
      ...state.projects.map((r) => ({ id: r.id, label: r.name, href: `/projects/${r.id}` })),
      ...state.people.map((r) => ({ id: r.id, label: r.name, href: `/people/${r.id}` })),
    ].map((r) => [r.id, r]),
  );
  const records = new Map(
    [
      ...state.actions,
      ...state.grants,
      ...state.executions,
      ...state.evidence,
      ...state.decisions,
      ...state.commitments,
      ...state.interactions,
      ...state.importantDates,
      ...state.peopleResponses,
      ...state.reminders,
    ].map((r) => [r.id, r]),
  );
  const executionIds = new Set(state.executions.map((e) => e.id));
  return state.audit
    .map((event) => {
      const actor = identities.get(event.actorId);
      const changes = fields(event.changes),
        after = fields(changes.after);
      const direct = destinations.get(event.entityId);
      const record = records.get(event.entityId);
      const parent = fields(record);
      const subject = typeof parent.subjectId === 'string' ? parent.subjectId : '';
      const related = fields(records.get(subject));
      const parentId = String(
        parent.workstreamId ??
          parent.operationId ??
          parent.personId ??
          related.workstreamId ??
          related.personId ??
          subject,
      );
      const destination = direct ?? destinations.get(parentId);
      const identity = identities.get(event.entityId);
      const title = String(
        after.title ??
          after.name ??
          destination?.label ??
          identity?.name ??
          (event.entityId === state.workspaceId ? 'Workspace settings' : 'Workspace record'),
      );
      const href = destination?.href;
      // The event snapshot describes what was reported then; later reconciliation must not rewrite it.
      const execution = executionIds.has(event.entityId);
      const outcome =
        execution && typeof after.state === 'string' && after.state in activityOutcomes
          ? after.state
          : 'recorded';
      return {
        event,
        actorName: actor?.name ?? 'Unknown actor',
        actorKind: actor?.kind ?? 'unknown',
        title,
        href,
        outcome,
      };
    })
    .sort((a, b) => b.event.at.localeCompare(a.event.at) || b.event.id.localeCompare(a.event.id));
}
export type ActivityEntry = ReturnType<typeof activityEntries>[number];
export function filterActivity(
  entries: ActivityEntry[],
  filters: {
    actor?: string;
    command?: string;
    outcome?: string;
    query?: string;
    from?: string;
    to?: string;
  },
  timezone: string,
) {
  return entries.filter((e) => {
    const actor = filters.actor ?? 'agents';
    const date = localDate(Date.parse(e.event.at), timezone);
    return (
      (actor === 'all' ||
        (actor === 'agents'
          ? ['agent', 'integration'].includes(e.actorKind)
          : e.event.actorId === actor)) &&
      (!filters.command || e.event.command === filters.command) &&
      (!filters.outcome || e.outcome === filters.outcome) &&
      (!filters.from || date >= filters.from) &&
      (!filters.to || date <= filters.to) &&
      (!filters.query ||
        `${e.title} ${e.actorName} ${e.event.command} ${e.event.reason} ${e.event.entityId}`
          .toLowerCase()
          .includes(filters.query.toLowerCase()))
    );
  });
}
