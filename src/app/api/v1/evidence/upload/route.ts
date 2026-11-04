import { createHash } from 'node:crypto';
import { authenticate, checkOrigin } from '../../../../../server/auth';
import { admin } from '../../../../../server/supabase';
import { execute, hash, SupabaseRepository } from '../../../../../server/repository';
import { applyCommand } from '../../../../../domain/service';
import { assert, DomainError } from '../../../../../domain/errors';
import { failure, json } from '../../../../../server/http';
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const actor = await authenticate(r),
      key = r.headers.get('idempotency-key') ?? '';
    assert(/^[\w.-]{8,128}$/.test(key), 'idempotency_required', 'Provide an Idempotency-Key.');
    const form = await r.formData(),
      file = form.get('file');
    assert(
      file instanceof File && file.size > 0 && file.size <= 3145728,
      'validation',
      'Choose a file of up to 3 MiB.',
    );
    const metadata = JSON.parse(String(form.get('metadata'))),
      parent = metadata.workstreamId ?? metadata.operationId;
    assert(
      typeof parent === 'string' && /^[a-f0-9-]{36}$/.test(parent),
      'validation',
      'Choose a valid parent record.',
    );
    const buffer = Buffer.from(await file.arrayBuffer()),
      sha256 = createHash('sha256').update(buffer).digest('hex');
    const path = `${actor.workspaceId}/${parent}/${hash({ actor: actor.id, key })}-${sha256}`;
    const input = { ...metadata, storagePath: path, sha256 },
      repo = new SupabaseRepository();
    const prior = await repo.replay(actor, key, hash({ name: 'evidence.attach', input }));
    if (prior !== undefined) return json({ result: prior });
    applyCommand(await repo.load(actor.workspaceId), actor, 'evidence.attach', input);
    const { error } = await admin()
      .storage.from('evidence')
      .upload(path, buffer, { contentType: 'application/octet-stream', upsert: false });
    if (error && error.message !== 'The resource already exists')
      throw new DomainError('upload_failed', 'File could not be uploaded.', 503);
    return json({ result: await execute(repo, actor, 'evidence.attach', input, key) });
  } catch (e) {
    return failure(e);
  }
}
