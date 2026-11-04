import { DomainError } from '../domain/errors';
import { ZodError, flattenError } from 'zod';
export function failure(e: unknown): Response {
  if (e instanceof ZodError)
    return Response.json(
      {
        error: { code: 'validation', message: 'Invalid request input.', details: flattenError(e) },
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  if (e instanceof SyntaxError)
    return Response.json(
      { error: { code: 'validation', message: 'Request must contain valid JSON.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  if (e instanceof DomainError)
    return Response.json(
      { error: { code: e.code, message: e.message, details: e.details } },
      { status: e.status, headers: { 'Cache-Control': 'no-store' } },
    );
  // No request bodies, tokens, evidence, or provider errors in application logs.
  return Response.json(
    { error: { code: 'internal_error', message: 'The request could not be completed.' } },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function body(request: Request) {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = '',
    bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 256000) {
          void reader.cancel().catch(() => {});
          throw new DomainError('payload_too_large', 'Request exceeds 256 KB.', 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError('validation', 'Request must contain valid JSON.', 400);
  }
}
