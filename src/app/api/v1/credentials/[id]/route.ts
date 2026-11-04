import { authenticate, checkOrigin } from '../../../../../server/auth';
import { revokeCredential } from '../../../../../server/credentials';
import { failure, json } from '../../../../../server/http';
export async function DELETE(r: Request, c: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(r);
    return json(
      await revokeCredential(
        await authenticate(r),
        (await c.params).id,
        Number(r.headers.get('if-match')),
        r.headers.get('idempotency-key') ?? '',
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
