import { recordFailure } from './attempts';
import { admin } from './supabase';
import { tokenHash, SupabaseRepository } from './repository';
import { assert, DomainError } from '../domain/errors';
import type { Actor } from '../domain/types';
export async function authenticate(request: Request): Promise<Actor> {
  assert(
    process.env.ACCORD_DEMO !== 'true',
    'demo_read_only',
    'The fictional preview does not accept workspace credentials or mutations.',
    403,
  );
  const auth = request.headers.get('authorization');
  assert(
    auth && auth.startsWith('Bearer '),
    'unauthenticated',
    'Sign in or provide an agent bearer token.',
    401,
  );
  const token = auth.slice(7);
  if (token.startsWith('accord_')) {
    const { data, error } = await admin()
      .from('agent_credentials')
      .select('id,workspace_id,identity_id,scopes,assignments,access_mode,expires_at,revoked_at')
      .eq('token_hash', tokenHash(token))
      .maybeSingle();
    if (error)
      throw new DomainError(
        'auth_unavailable',
        'Credential validation is temporarily unavailable.',
        503,
      );
    assert(data, 'unauthenticated', 'Token is invalid, expired, or revoked.', 401);
    if (data.revoked_at || !(Date.parse(data.expires_at) > Date.now())) {
      try {
        const state = await new SupabaseRepository().load(data.workspace_id, { history: false });
        const identity = state.identities.find((i) => i.id === data.identity_id);
        if (identity && (identity.kind === 'agent' || identity.kind === 'integration')) {
          // Attribution from the matched stored hash is for diagnostics only, never authorization.
          await rejectedCredential(
            request,
            {
              id: identity.id,
              workspaceId: data.workspace_id,
              kind: identity.kind,
              scopes: [],
              assignments: [],
            },
            data.revoked_at ? 'credential_revoked' : 'credential_expired',
          );
        }
      } catch {
        /* Diagnostic persistence must not change an authentication rejection. */
      }
      throw new DomainError('unauthenticated', 'Token is invalid, expired, or revoked.', 401);
    }
    const state = await new SupabaseRepository().load(data.workspace_id, { history: false });
    const i = state.identities.find((i) => i.id === data.identity_id);
    assert(
      i && (i.kind === 'agent' || i.kind === 'integration'),
      'unauthenticated',
      'Credential identity is unavailable.',
      401,
    );
    assert(
      data.access_mode === undefined ||
        data.access_mode === 'assigned' ||
        (data.access_mode === 'workspace' && i.kind === 'agent'),
      'unauthenticated',
      'Credential access mode is invalid.',
      401,
    );
    return {
      id: i.id,
      workspaceId: data.workspace_id,
      kind: i.kind,
      scopes: data.scopes,
      assignments: data.assignments,
      accessMode: data.access_mode ?? 'assigned',
      credentialId: data.id,
    };
  }
  const { data, error } = await admin().auth.getUser(token);
  assert(!error && data.user, 'unauthenticated', 'Session is invalid or expired.', 401);
  const { data: w, error: workspaceError } = await admin()
    .from('workspaces')
    .select('id')
    .eq('owner_auth_user_id', data.user.id)
    .maybeSingle();
  if (workspaceError)
    throw new DomainError('auth_unavailable', 'Owner validation is temporarily unavailable.', 503);
  assert(w, 'forbidden', 'This account is not an installed workspace owner.', 403);
  const s = await new SupabaseRepository().load(w.id, { history: false });
  const i = s.identities.find((i) => i.kind === 'human' && i.authUserId === data.user.id);
  assert(i, 'forbidden', 'Owner identity is missing.', 403);
  // Supabase JWT AAL must be aal2 whenever the account has a verified MFA factor.
  const factors = data.user.factors?.filter((f) => f.status === 'verified') ?? [];
  if (factors.length) {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert(payload.aal === 'aal2', 'mfa_required', 'Complete two-factor verification.', 403);
  }
  return { id: i.id, workspaceId: w.id, kind: 'human', scopes: ['*'], assignments: [] };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin)
    assert(
      origin === process.env.ACCORD_ORIGIN,
      'origin_rejected',
      'Request origin is not allowed.',
      403,
    );
}

async function rejectedCredential(request: Request, actor: Actor, code: string) {
  const path = new URL(request.url).pathname;
  if (
    !path.startsWith('/api/v1/commands/') &&
    !['/mcp', '/api/v1/state', '/api/v1/attention'].includes(path)
  )
    return;
  const started = performance.now();
  const name =
    path === '/mcp'
      ? 'unknown.command'
      : path === '/api/v1/state'
        ? 'query'
        : path === '/api/v1/attention'
          ? 'attention.query'
          : (path.split('/').at(-1) ?? 'unknown.command');
  const key = request.headers.get('idempotency-key') ?? '';
  await recordFailure(
    new SupabaseRepository(),
    actor,
    { name, key, transport: path === '/mcp' ? 'mcp' : 'rest', started },
    new DomainError(code, '', 401),
  );
}
