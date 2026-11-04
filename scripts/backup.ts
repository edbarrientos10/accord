import './env';
import { writeFile, mkdir } from 'node:fs/promises';
import { admin } from '../src/server/supabase';
import { SupabaseRepository } from '../src/server/repository';
import { makeArchive } from '../src/server/export';
const db = admin(),
  { data, error } = await db.from('workspaces').select('id').single();
if (error || !data)
  throw new Error('Select an installed Supabase project through the environment.');
const state = await new SupabaseRepository().load(data.id),
  ids = [...state.workstreams, ...state.operations, ...state.projects].map((x) => x.id);
const archive = ids.length
  ? await makeArchive(state, ids, true)
  : {
      format: 'accord.v3',
      exportedAt: new Date().toISOString(),
      state: { ...state, identities: state.identities.map(({ authUserId, ...i }) => i) },
      files: [],
    };
await mkdir('backups', { recursive: true, mode: 0o700 });
const path = `backups/accord-${new Date().toISOString().replaceAll(':', '-')}.json`;
await writeFile(path, JSON.stringify(archive), { mode: 0o600, flag: 'wx' });
console.log(
  `Backup saved to ${path}. Credentials are excluded. Keep this private archive encrypted at rest.`,
);
