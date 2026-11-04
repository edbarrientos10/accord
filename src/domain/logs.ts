import { z } from 'zod';
import type { State } from './types';
import { activityEntries, filterActivity } from './activity';
import type { CommandAttempt } from '../server/attempts';
export { logOutcomes } from './log-types';
export type { LogSummary, LogPage, LogDetail } from './log-types';
import { logOutcomes, type LogSummary, type LogPage } from './log-types';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const logQuerySchema = z.object({
  actor: z.union([z.enum(['agents', 'all']), z.guid()]).default('agents'),
  command: z.string().max(100).default(''),
  outcome: z
    .union([z.literal(''), z.enum(Object.keys(logOutcomes) as [string, ...string[]])])
    .default(''),
  q: z.string().max(200).default(''),
  from: date.optional(),
  to: date.optional(),
  entity: z.guid().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const logCursorSchema = z
  .object({ at: z.string().datetime({ offset: true }), id: z.guid() })
  .strict();
export type LogQuery = z.infer<typeof logQuerySchema>;
// URI JSON is intentionally opaque to UI consumers, validated again on every request.
export const encodeCursor = (row: LogSummary) => JSON.stringify({ at: row.at, id: row.id });
export function decodeCursor(value?: string) {
  return value ? logCursorSchema.parse(JSON.parse(value)) : undefined;
}
export function fixtureLogSummaries(
  state: State,
  attempts: { actorId: string; event: CommandAttempt }[] = [],
): LogSummary[] {
  return [
    ...activityEntries(state).map((e) => {
      const related = e.href?.split('/').at(-1);
      return {
        id: e.event.id,
        actorId: e.event.actorId,
        actorName: e.actorName,
        actorKind: e.actorKind,
        at: e.event.at,
        command: e.event.command,
        entityId: e.event.entityId,
        title: e.title.slice(0, 240),
        reason: e.event.reason.slice(0, 1000),
        outcome: e.outcome,
        kind: 'change' as const,
        contextIds: [e.event.entityId, ...(related ? [related] : [])],
      };
    }),
    ...attempts.map(({ actorId, event: e }) => {
      const actor = state.identities.find((i) => i.id === actorId);
      return {
        id: e.id,
        actorId,
        actorName: actor?.name ?? 'Unknown actor',
        actorKind: actor?.kind ?? 'agent',
        at: e.at,
        command: e.command,
        entityId: e.entityId,
        title: 'Command attempt',
        reason: e.message,
        outcome: e.outcome,
        kind: 'attempt' as const,
        contextIds: e.entityId ? [e.entityId] : [],
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
/** Fictional preview / test adapter only. Production filtering and pagination happen in SQL. */
export function fixtureLogPage(
  state: State,
  query: LogQuery,
  attempts: { actorId: string; event: CommandAttempt }[] = [],
): LogPage {
  const cursor = decodeCursor(query.cursor);
  const rows = fixtureLogSummaries(state, attempts).filter((r) => {
    const mock = {
      event: {
        id: r.id,
        actorId: r.actorId,
        at: r.at,
        command: r.command,
        entityId: r.entityId ?? '',
        reason: r.reason,
        changes: null,
      },
      actorName: r.actorName,
      actorKind: r.actorKind,
      title: r.title,
      outcome: r.outcome,
      href: undefined,
    };
    return (
      filterActivity([mock], { ...query, query: undefined }, state.timezone).length > 0 &&
      query.q
        .toLowerCase()
        .split(/\W+/)
        .filter(Boolean)
        .every((word) =>
          `${r.title} ${r.reason} ${r.command} ${r.actorName} ${r.entityId}`
            .toLowerCase()
            .includes(word),
        ) &&
      (!query.entity || r.contextIds.includes(query.entity)) &&
      (!cursor || r.at < cursor.at || (r.at === cursor.at && r.id < cursor.id))
    );
  });
  const items = rows.slice(0, query.limit);
  return { items, nextCursor: rows.length > query.limit ? encodeCursor(items.at(-1)!) : null };
}
