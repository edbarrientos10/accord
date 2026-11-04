import './env';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { admin } from '../src/server/supabase';
import { prepareRestore, validateArchive } from '../src/server/export';
import { SupabaseRepository, hash } from '../src/server/repository';
const path = process.argv[2];
if (!path) throw new Error('Usage: npm run restore -- /private/path/accord-backup.json');
const archive = validateArchive(JSON.parse(await readFile(path, 'utf8'))),
  db = admin(),
  { data, error } = await db.from('workspaces').select('id').single();
if (error || !data) throw new Error('Bootstrap an empty destination first.');
const repo = new SupabaseRepository(),
  before = await repo.load(data.id),
  after = prepareRestore(archive, before),
  owner = before.identities.find((i) => i.kind === 'human')!;
for (const f of archive.files) {
  const destination = f.path.replace(`${archive.state.workspaceId}/`, `${before.workspaceId}/`);
  const { error } = await db.storage
    .from('evidence')
    .upload(destination, Buffer.from(f.base64, 'base64'), {
      contentType: 'application/octet-stream',
      upsert: false,
    });
  const { data: stored, error: readError } = await db.storage
    .from('evidence')
    .download(destination);
  if (
    readError ||
    !stored ||
    createHash('sha256')
      .update(Buffer.from(await stored.arrayBuffer()))
      .digest('hex') !== f.sha256
  )
    throw new Error(
      'Destination evidence could not be verified. No coordination records were committed; inspect the isolated destination before retrying.',
    );
}
const result = await repo.commit(
  { id: owner.id, workspaceId: before.workspaceId, kind: 'human', scopes: ['*'], assignments: [] },
  randomUUID(),
  hash({ archive: archive.exportedAt, source: archive.state.workspaceId }),
  before,
  after,
  { id: before.workspaceId },
);
if (result.conflict)
  throw new Error('Destination changed during restore. No coordination records were restored.');
console.log(
  'Archive restored. Issue fresh agent credentials and review standing permissions before reconnecting agents.',
);
