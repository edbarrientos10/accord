import { recordFailure, logStatus } from '../../../../server/attempts';
import type { Actor } from '../../../../domain/types';
import { authenticate } from '../../../../server/auth';
import { SupabaseRepository } from '../../../../server/repository';
import { visibleState } from '../../../../domain/service';
import { failure, json } from '../../../../server/http';
import { demoState } from '../../../../server/demo';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let actor: Actor | undefined;
  const started = performance.now();
  try {
    const history = new URL(request.url).searchParams.get('history') !== 'none';
    if (process.env.ACCORD_DEMO === 'true') {
      const state = demoState();
      if (!history) state.audit = [];
      return json({ state, demo: true });
    }
    actor = await authenticate(request);
    return json({
      state: visibleState(
        await new SupabaseRepository().load(actor.workspaceId, { history }),
        actor,
      ),
      actor,
    });
  } catch (e) {
    if (actor)
      await recordFailure(
        new SupabaseRepository(),
        actor,
        { name: 'query', transport: 'rest', started },
        e,
      );
    const response = failure(e);
    if (logStatus(e)) response.headers.set('X-Accord-Log-Status', logStatus(e)!);
    return response;
  }
}
