import { z } from 'zod';
import { authenticate } from '../../../../../server/auth';
import { failure, json } from '../../../../../server/http';
import { readActivity } from '../../../../../server/activity-log';
import { fixtureLogSummaries } from '../../../../../domain/logs';
import { demoState, demoAttempts } from '../../../../../server/demo';
import { assert } from '../../../../../domain/errors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = z.guid().parse((await context.params).id);
    if (process.env.ACCORD_DEMO === 'true') {
      const state = demoState(),
        attempts = demoAttempts(state),
        summary = fixtureLogSummaries(state, attempts).find((r) => r.id === id);
      assert(summary, 'not_found', 'Activity event is not available.', 404);
      return json({
        summary,
        event: state.audit.find((e) => e.id === id) ?? null,
        attempt: attempts.find((a) => a.event.id === id)?.event ?? null,
      });
    }
    return json(await readActivity(await authenticate(request), id));
  } catch (e) {
    return failure(e);
  }
}
