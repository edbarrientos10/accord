import { authenticate } from '../../../../../../server/auth';
import { admin } from '../../../../../../server/supabase';
import { SupabaseRepository } from '../../../../../../server/repository';
import { visibleState } from '../../../../../../domain/service';
import { assert } from '../../../../../../domain/errors';
import { failure, json } from '../../../../../../server/http';
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticate(r),
      s = visibleState(await new SupabaseRepository().load(actor.workspaceId), actor);
    const id = (await c.params).id;
    const record = s.evidence.find((e) => e.id === id);
    assert(record?.storagePath, 'not_found', 'File evidence not found.', 404);
    const { data, error } = await admin()
      .storage.from('evidence')
      .createSignedUrl(record.storagePath, 60, { download: true });
    assert(!error && data, 'download_failed', 'File could not be accessed.', 503);
    return json({ url: data.signedUrl, expiresIn: 60 });
  } catch (e) {
    return failure(e);
  }
}
