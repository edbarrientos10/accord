import { authenticate, checkOrigin } from '../../../../../server/auth';
import { execute, SupabaseRepository } from '../../../../../server/repository';
import { body, failure, json } from '../../../../../server/http';
import { rejectRawFileReference } from '../../../../../server/mcp';
import { recordFailure, logStatus } from '../../../../../server/attempts';
import type { Actor } from '../../../../../domain/types';
export async function POST(request: Request, context: { params: Promise<{ command: string }> }) {
  const started = performance.now(),
    repo = new SupabaseRepository();
  let actor: Actor | undefined,
    input: unknown,
    command = 'unknown.command';
  const key = request.headers.get('idempotency-key') ?? '';
  try {
    actor = await authenticate(request);
    ({ command } = await context.params);
    checkOrigin(request);
    input = await body(request);
    rejectRawFileReference(command, input);
    return json({ result: await execute(repo, actor, command, input, key) });
  } catch (e) {
    if (actor)
      await recordFailure(
        repo,
        actor,
        { name: command, input, key, transport: 'rest', started },
        e,
      );
    const response = failure(e);
    if (logStatus(e)) response.headers.set('X-Accord-Log-Status', logStatus(e)!);
    return response;
  }
}
