import { recordFailure, logStatus } from '../../../../server/attempts';
import type { Actor } from '../../../../domain/types';
import { authenticate } from '../../../../server/auth';
import { SupabaseRepository } from '../../../../server/repository';
import { visibleState } from '../../../../domain/service';
import { decisionQueue } from '../../../../domain/presentation';
import { failure, json } from '../../../../server/http';
import { demoState } from '../../../../server/demo';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let actor: Actor | undefined;
  const started = performance.now();
  try {
    if (process.env.ACCORD_DEMO === 'true')
      return json({ items: decisionQueue(demoState()), demo: true });
    actor = await authenticate(request);
    return json({
      items: decisionQueue(
        visibleState(
          await new SupabaseRepository().load(actor.workspaceId, { history: false }),
          actor,
        ),
      ),
    });
  } catch (e) {
    if (actor)
      await recordFailure(
        new SupabaseRepository(),
        actor,
        { name: 'attention.query', transport: 'rest', started },
        e,
      );
    const response = failure(e);
    if (logStatus(e)) response.headers.set('X-Accord-Log-Status', logStatus(e)!);
    return response;
  }
}
