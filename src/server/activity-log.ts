import { assert, DomainError } from '../domain/errors';
import type { Actor, Audit } from '../domain/types';
import {
  decodeCursor,
  encodeCursor,
  type LogQuery,
  type LogSummary,
  type LogPage,
  type LogDetail,
} from '../domain/logs';
import { inspectable } from '../domain/activity';
import { admin } from './supabase';
export function requireLogOwner(actor: Actor) {
  assert(
    actor.kind === 'human',
    'human_required',
    'Only the workspace owner can inspect request diagnostics.',
    403,
  );
}
export async function listActivity(actor: Actor, query: LogQuery): Promise<LogPage> {
  requireLogOwner(actor);
  const cursor = decodeCursor(query.cursor);
  const { data, error } = await admin().rpc('accord_activity_page', {
    p_workspace: actor.workspaceId,
    p_actor: query.actor,
    p_command: query.command,
    p_outcome: query.outcome,
    p_query: query.q,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
    p_entity: query.entity ?? null,
    p_before_at: cursor?.at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: query.limit,
  });
  if (error)
    throw new DomainError(
      'storage_error',
      'Activity could not be loaded. Check the activity-log migration and retry.',
      503,
    );
  const rows = data as LogSummary[];
  const items = rows.slice(0, query.limit);
  return { items, nextCursor: rows.length > query.limit ? encodeCursor(items.at(-1)!) : null };
}
export async function readActivity(actor: Actor, id: string): Promise<LogDetail> {
  requireLogOwner(actor);
  const { data: row, error } = await admin()
    .from('activity_log')
    .select('summary,detail,kind')
    .eq('workspace_id', actor.workspaceId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DomainError('storage_error', 'Activity detail could not be loaded.', 503);
  assert(row, 'not_found', 'Activity event is not available.', 404);
  if (row.kind === 'attempt') return { summary: row.summary, event: null, attempt: row.detail };
  const { data, eventError } = await admin()
    .from('audit_events')
    .select('body')
    .eq('workspace_id', actor.workspaceId)
    .eq('id', id)
    .maybeSingle()
    .then(({ data, error }) => ({ data, eventError: error }));
  if (eventError)
    throw new DomainError('storage_error', 'Recorded changes could not be loaded.', 503);
  assert(data, 'not_found', 'Recorded changes are not available.', 404);
  return { summary: row.summary, event: inspectable(data.body) as Audit, attempt: null };
}
