import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { admin } from './supabase';
import { hash, SupabaseRepository, tokenHash } from './repository';
import { assert, DomainError } from '../domain/errors';
import { workspaceAgentScopes, peopleScopes } from '../domain/permissions';
import { agentScopes } from '../domain/commands';
import type { Actor } from '../domain/types';
const schema = z
  .object({
    identityId: z.guid(),
    scopes: z.array(z.string()).min(1),
    assignments: z.array(z.guid()),
    accessMode: z.enum(['assigned', 'workspace']).default('assigned'),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export async function createCredential(actor: Actor, input: unknown, key: string) {
  assert(/^[\w.-]{8,128}$/.test(key), 'idempotency_required', 'Provide an Idempotency-Key.');
  assert(actor.kind === 'human', 'human_required', 'Only the owner issues credentials.', 403);
  const p = schema.parse(input),
    db = admin(),
    state = await new SupabaseRepository().load(actor.workspaceId, { history: false }),
    i = state.identities.find((i) => i.id === p.identityId);
  assert(
    i && (i.kind === 'agent' || i.kind === 'integration'),
    'validation',
    'Choose an agent or integration identity.',
  );
  assert(
    p.accessMode !== 'workspace' || (i.kind === 'agent' && p.assignments.length === 0),
    'validation',
    'Workspace access requires an agent and an empty record assignment list.',
  );
  const allowed =
    i.kind === 'integration'
      ? ['read', 'evidence.verify']
      : [
          'read',
          'people.read',
          ...agentScopes,
          ...(p.accessMode === 'workspace' ? workspaceAgentScopes : []),
        ];
  assert(
    p.scopes.every((s) => allowed.includes(s)),
    'validation',
    'Scope cannot grant human authority or independent verification to agents.',
  );
  assert(
    !p.scopes.some((s) => peopleScopes.includes(s as (typeof peopleScopes)[number])) ||
      p.scopes.includes('people.read'),
    'validation',
    'People mutations require people.read.',
  );
  assert(
    p.accessMode === 'workspace' ||
      p.assignments.length > 0 ||
      (p.scopes.includes('people.read') &&
        p.scopes.every(
          (s) => s === 'people.read' || peopleScopes.includes(s as (typeof peopleScopes)[number]),
        )),
    'validation',
    'Task capabilities require record assignments.',
  );
  for (const id of p.assignments) {
    const entity = [...state.workstreams, ...state.operations].find((w) => w.id === id);
    assert(
      entity && (i.kind === 'integration' || entity.assignedAgentIds.includes(i.id)),
      'validation',
      'Assign this agent to every selected record before issuing the token.',
    );
  }
  const expires = p.expiresAt ?? new Date(Date.now() + 90 * 86400000).toISOString();
  assert(
    Date.parse(expires) > Date.now() && Date.parse(expires) <= Date.now() + 366 * 86400000,
    'validation',
    'Token expiry must be within the next year.',
  );
  const token = `accord_${randomBytes(32).toString('base64url')}`,
    id = randomUUID();
  // Keep assigned-mode request hashes compatible with pre-accessMode retries.
  const { accessMode, ...assignedInput } = p;
  // Credential issuance and its audit record are committed together in an RPC.
  const { data, error } = await db.rpc('accord_credential_create', {
    p_id: id,
    p_workspace: actor.workspaceId,
    p_actor: actor.id,
    p_identity: i.id,
    p_hash: tokenHash(token),
    p_scopes: p.scopes,
    p_assignments: p.assignments,
    p_access_mode: p.accessMode,
    p_expires: expires,
    p_key: key,
    p_request_hash: hash({
      command: 'credential.create',
      input: accessMode === 'assigned' ? assignedInput : p,
    }),
  });
  if (error) throw new DomainError('storage_error', 'Credential could not be issued.', 503);
  return {
    ...data,
    token: data.created ? token : undefined,
    message: data.created
      ? 'Save this token now. It cannot be displayed again.'
      : 'Credential was already issued. Revoke and replace it if the original token was lost.',
  };
}
export async function revokeCredential(
  actor: Actor,
  id: string,
  expectedVersion: number,
  key: string,
) {
  assert(actor.kind === 'human', 'human_required', 'Only the owner revokes credentials.', 403);
  assert(/^[\w.-]{8,128}$/.test(key), 'idempotency_required', 'Provide an Idempotency-Key.');
  const { data, error } = await admin().rpc('accord_credential_revoke', {
    p_workspace: actor.workspaceId,
    p_actor: actor.id,
    p_id: id,
    p_expected: expectedVersion,
    p_key: key,
    p_request_hash: hash({ command: 'credential.revoke', id, expectedVersion }),
  });
  if (error) throw new DomainError('conflict', 'Reload the credential before revoking it.', 409);
  return data;
}
export async function listCredentials(actor: Actor) {
  assert(actor.kind === 'human', 'human_required', 'Only the owner can inspect credentials.', 403);
  const { data, error } = await admin()
    .from('agent_credentials')
    .select(
      'id,identity_id,version,scopes,assignments,access_mode,expires_at,revoked_at,created_at',
    )
    .eq('workspace_id', actor.workspaceId);
  if (error) throw new DomainError('storage_error', 'Credential list unavailable.', 503);
  return data;
}
