import { canUseCommand } from '../domain/access';
import type { CommandName } from '../domain/commands';
import { normalizePeople, peopleRecords } from '../domain/people';
import { normalizeTaskLinks } from '../domain/task-links';
import { createHash } from 'node:crypto';
import type { Actor, State } from '../domain/types';
import { applyCommand, visibleState, scope } from '../domain/service';
import { assert, DomainError } from '../domain/errors';
import { admin } from './supabase';
export interface Repository {
  load(workspaceId: string, options?: { history?: boolean }): Promise<State>;
  recordAttempt?(actor: Actor, event: import('./attempts').CommandAttempt): Promise<void>;
  replay(actor: Actor, key: string, hash: string): Promise<unknown | undefined>;
  commit(
    actor: Actor,
    key: string,
    hash: string,
    before: State,
    after: State,
    result: unknown,
  ): Promise<{ conflict?: boolean; result?: unknown }>;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export const tokenHash = (v: string) => createHash('sha256').update(v).digest('hex');
export class SupabaseRepository implements Repository {
  async load(workspaceId: string, options: { history?: boolean } = {}) {
    const { data, error } = await admin().rpc(
      options.history === false ? 'accord_current_snapshot' : 'accord_snapshot',
      { p_workspace: workspaceId },
    );
    if (error) throw new DomainError('storage_error', 'Workspace could not be loaded.', 503);
    assert(data, 'not_found', 'Workspace not found.', 404);
    return normalizeTaskLinks(normalizePeople(data as State));
  }
  async recordAttempt(actor: Actor, event: import('./attempts').CommandAttempt) {
    const { error } = await admin()
      .rpc('accord_record_attempt', {
        p_workspace: actor.workspaceId,
        p_actor: actor.id,
        p_event: event,
      })
      .abortSignal(AbortSignal.timeout(1500));
    if (error) throw new DomainError('log_unavailable', 'Attempt logging is unavailable.', 503);
  }
  async replay(actor: Actor, key: string, requestHash: string) {
    const { data, error } = await admin()
      .from('idempotency_records')
      .select('request_hash,result')
      .eq('workspace_id', actor.workspaceId)
      .eq('actor_id', actor.id)
      .eq('key', key)
      .maybeSingle();
    if (error) throw new DomainError('storage_error', 'Retry state unavailable.', 503);
    if (data) {
      assert(
        data.request_hash === requestHash,
        'idempotency_mismatch',
        'This key was already used with different content.',
        409,
      );
      return data.result;
    }
  }
  async commit(
    actor: Actor,
    key: string,
    requestHash: string,
    before: State,
    after: State,
    result: unknown,
  ) {
    const priorAuditIds = new Set(before.audit.map((event) => event.id));
    const { data, error } = await admin().rpc('accord_commit', {
      p_workspace: actor.workspaceId,
      p_revision: before.revision,
      p_actor: actor.id,
      p_key: key,
      p_hash: requestHash,
      p_state: { ...after, audit: after.audit.filter((event) => !priorAuditIds.has(event.id)) },
      p_result: result,
      p_credential: actor.credentialId ?? null,
    });
    if (error) {
      if (error.message.includes('credential_revoked'))
        throw new DomainError(
          'unauthenticated',
          'Credential was revoked or expired before the transaction committed.',
          401,
        );
      throw new DomainError(
        error.message.includes('idempotency_mismatch') ? 'idempotency_mismatch' : 'storage_error',
        error.message.includes('idempotency_mismatch')
          ? 'This key was already used with different content.'
          : 'The transaction failed; no partial change was committed.',
        error.message.includes('idempotency_mismatch') ? 409 : 503,
      );
    }
    return data as { conflict?: boolean; result?: unknown };
  }
}
export async function execute(
  repo: Repository,
  actor: Actor,
  name: string,
  input: unknown,
  key: string,
) {
  assert(
    /^[\w.-]{8,128}$/.test(key),
    'idempotency_required',
    'Provide an Idempotency-Key of 8–128 letters, digits, dots, underscores, or hyphens.',
  );
  const requestHash = hash({ name, input });
  const prior = await repo.replay(actor, key, requestHash);
  if (prior !== undefined) {
    authorizeReplay(await repo.load(actor.workspaceId, { history: false }), actor, name, prior);
    return safeResult(await repo.load(actor.workspaceId, { history: false }), actor, prior);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await repo.load(actor.workspaceId, { history: false });
    // Authorize against the same filtered assignments used by read clients.
    if (actor.kind !== 'human')
      visibleState(before, { ...actor, scopes: [...actor.scopes, 'read'] });
    const { state, result } = applyCommand(before, actor, name, input);
    const committed = await repo.commit(actor, key, requestHash, before, state, result);
    if (!committed.conflict) return safeResult(state, actor, committed.result);
    const replay = await repo.replay(actor, key, requestHash);
    if (replay !== undefined) {
      authorizeReplay(await repo.load(actor.workspaceId, { history: false }), actor, name, replay);
      return safeResult(await repo.load(actor.workspaceId, { history: false }), actor, replay);
    }
  }
  throw new DomainError(
    'conflict',
    'Concurrent changes prevented this update. Reload and retry.',
    409,
  );
}
function authorizeReplay(state: State, actor: Actor, name: string, result: unknown) {
  scope(actor, name);
  assert(
    canUseCommand(actor, name as CommandName),
    'forbidden',
    'This credential cannot replay this command.',
    403,
  );
  if (actor.kind === 'human') return;
  const visible = visibleState(state, { ...actor, scopes: [...actor.scopes, 'read'] });
  const id = result && typeof result === 'object' && 'id' in result ? result.id : undefined;
  assert(
    [
      ...visible.projects,
      ...visible.workstreams,
      ...visible.operations,
      ...visible.actions,
      ...visible.grants,
      ...visible.executions,
      ...visible.evidence,
      ...peopleRecords(visible),
    ].some((e) => e.id === id),
    'forbidden',
    'The retry result is no longer within this credential’s assignments.',
    403,
  );
}

function safeResult(state: State, actor: Actor, result: unknown) {
  if (actor.kind === 'human' || !result || typeof result !== 'object' || !('id' in result))
    return result;
  if (state.commitments.some((c) => c.id === result.id)) {
    const v = visibleState(state, actor);
    const c = v.commitments.find((c) => c.id === result.id);
    assert(c, 'forbidden', 'People access is required.', 403);
    return { ...result, workstreamId: c.workstreamId, projectId: c.projectId };
  }
  return result;
}
