import { createHash, randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import type { Actor } from '../domain/types';
import { DomainError } from '../domain/errors';
import { schemas } from '../domain/commands';
import type { Repository } from './repository';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface CommandAttempt {
  id: string;
  at: string;
  command: string;
  entityId: string | null;
  outcome: 'rejected' | 'error';
  code: string;
  message: string;
  transport: 'rest' | 'mcp';
  durationMs: number;
  retryReference: string | null;
  validationFields: string[];
}
const messages: Record<string, string> = {
  credential_revoked:
    'The agent credential has been revoked. The owner must issue a new credential.',
  credential_expired: 'The agent credential has expired. The owner must issue a new credential.',
  validation: 'The command input did not pass validation.',
  forbidden: 'The credential does not have access or permission for this command.',
  human_required: 'This action requires the human owner.',
  conflict: 'The record changed or another update conflicted. Reload before retrying.',
  not_found: 'The requested record was not available.',
  idempotency_mismatch: 'This retry key was already used with different content.',
  idempotency_required: 'A valid idempotency key is required.',
  unauthenticated: 'The credential was rejected before the operation completed.',
  payload_too_large: 'The request exceeded the input size limit.',
  origin_rejected: 'The browser request origin is not allowed.',
  storage_error: 'Storage could not confirm the operation. Reconcile or retry with the same key.',
};
const errorCodes = new WeakMap<object, string>();
export function logStatus(error: unknown) {
  return typeof error === 'object' && error !== null ? errorCodes.get(error) : undefined;
}
export async function recordFailure(
  repo: Repository,
  actor: Actor,
  context: {
    name: string;
    input?: unknown;
    key?: string;
    transport: 'rest' | 'mcp';
    started: number;
  },
  error: unknown,
) {
  const name =
    Object.hasOwn(schemas, context.name) || ['query', 'attention.query'].includes(context.name)
      ? context.name
      : 'unknown.command';
  const input =
    context.input && typeof context.input === 'object'
      ? (context.input as Record<string, unknown>)
      : {};
  const target = ['entityId', 'workstreamId', 'operationId', 'personId', 'projectId']
    .map((k) => input[k])
    .find((v) => z.guid().safeParse(v).success);
  const code =
    error instanceof ZodError || error instanceof SyntaxError
      ? 'validation'
      : error instanceof DomainError && /^[a-z_]{1,80}$/.test(error.code)
        ? error.code
        : 'internal_error';
  const rejected =
    error instanceof ZodError ||
    error instanceof SyntaxError ||
    (error instanceof DomainError && error.status < 500);
  const shape = Object.hasOwn(schemas, name) ? schemas[name as keyof typeof schemas].shape : {};
  const fieldNames =
    error instanceof ZodError
      ? error.issues.map((i) => String(i.path[0] ?? ''))
      : error instanceof DomainError &&
          error.code === 'validation' &&
          error.details &&
          typeof error.details === 'object' &&
          'fieldErrors' in error.details
        ? Object.keys((error.details as { fieldErrors: Record<string, unknown> }).fieldErrors ?? {})
        : [];
  const validationFields = [
    ...new Set(fieldNames.filter((key) => Object.hasOwn(shape, key))),
  ].slice(0, 20);
  const event: CommandAttempt = {
    id: randomUUID(),
    at: new Date().toISOString(),
    command: name,
    entityId: typeof target === 'string' ? target : null,
    outcome: rejected ? 'rejected' : 'error',
    code,
    message:
      messages[code] ??
      (rejected
        ? `The command was rejected (${code}).`
        : 'The operation could not be confirmed. Check the record before retrying.'),
    transport: context.transport,
    durationMs: Math.max(0, Math.round(performance.now() - context.started)),
    retryReference: context.key
      ? createHash('sha256')
          .update(JSON.stringify([actor.workspaceId, actor.id, context.key]))
          .digest('hex')
          .slice(0, 24)
      : null,
    validationFields,
  };
  try {
    if (!repo.recordAttempt) throw new Error('Logging unavailable');
    await repo.recordAttempt(actor, event);
    if (error && typeof error === 'object') errorCodes.set(error, 'recorded');
  } catch {
    if (error && typeof error === 'object') errorCodes.set(error, 'unavailable');
    // Sanitized operational fallback only; never include the error or request payload.
    console.error(
      JSON.stringify({
        event: 'accord_attempt_log_unavailable',
        attempt: event.id,
        workspace: actor.workspaceId,
        command: name,
        code,
      }),
    );
  }
}

/** Observe the public transport so SDK validation and unavailable tools are covered too. */
export function observeMcp(transport: Transport, repo: Repository, actor: Actor) {
  const pending = new Map<
    string | number,
    { name: string; input?: unknown; key?: string; started: number }
  >();
  const receive = transport.onmessage,
    send = transport.send.bind(transport);
  transport.onmessage = (message, extra) => {
    if ('method' in message && message.method === 'tools/call' && 'id' in message) {
      const p = message.params as
        { name?: string; arguments?: { input?: unknown; idempotencyKey?: unknown } } | undefined;
      const name =
        p?.name === 'accord_query'
          ? 'query'
          : p?.name === 'accord_attention'
            ? 'attention.query'
            : Object.keys(schemas).find((n) => `accord_${n.replaceAll('.', '_')}` === p?.name);
      pending.set(message.id, {
        name: name ?? 'unknown.command',
        input: p?.arguments?.input ?? p?.arguments,
        key:
          typeof p?.arguments?.idempotencyKey === 'string' ? p.arguments.idempotencyKey : undefined,
        started: performance.now(),
      });
    }
    receive?.(message, extra);
  };
  transport.send = async (message, options) => {
    if ('id' in message && message.id !== null && message.id !== undefined) {
      const context = pending.get(message.id);
      pending.delete(message.id);
      if (context) {
        const result =
          'result' in message
            ? (message.result as { isError?: boolean; content?: { type: string; text?: string }[] })
            : undefined;
        if ('error' in message || result?.isError) {
          let error: unknown = new DomainError('validation', 'Invalid tool invocation.');
          try {
            const parsed = JSON.parse(
              result?.content?.find((c) => c.type === 'text')?.text ?? '{}',
            );
            if (parsed.error?.code && /^[a-z_]{1,80}$/.test(parsed.error.code))
              error = new DomainError(
                parsed.error.code,
                '',
                parsed.error.status ??
                  (parsed.error.code === 'internal_error' || parsed.error.code === 'storage_error'
                    ? 503
                    : 400),
              );
          } catch {
            /* SDK validation text is deliberately not retained. */
          }
          if (
            Object.hasOwn(schemas, context.name) &&
            actor.kind !== 'human' &&
            !actor.scopes.includes(context.name)
          )
            error = new DomainError('forbidden', '', 403);
          await recordFailure(repo, actor, { ...context, transport: 'mcp' }, error);
          if (result)
            (result as Record<string, unknown>)._meta = { 'accord/logStatus': logStatus(error) };
        }
      }
    }
    return send(message, options);
  };
}
