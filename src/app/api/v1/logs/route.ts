import { authenticate } from '../../../../server/auth';
import { failure, json } from '../../../../server/http';
import { listActivity } from '../../../../server/activity-log';
import { fixtureLogPage, logQuerySchema } from '../../../../domain/logs';
import { demoState, demoAttempts } from '../../../../server/demo';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const query = logQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (process.env.ACCORD_DEMO === 'true') {
      const state = demoState();
      return json(fixtureLogPage(state, query, demoAttempts(state)));
    }
    return json(await listActivity(await authenticate(request), query));
  } catch (e) {
    return failure(e);
  }
}
