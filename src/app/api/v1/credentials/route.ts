import { authenticate, checkOrigin } from '../../../../server/auth';
import { createCredential, listCredentials } from '../../../../server/credentials';
import { body, failure, json } from '../../../../server/http';
export async function GET(r: Request) {
  try {
    return json({ credentials: await listCredentials(await authenticate(r)) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    return json(
      await createCredential(
        await authenticate(r),
        await body(r),
        r.headers.get('idempotency-key') ?? '',
      ),
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
