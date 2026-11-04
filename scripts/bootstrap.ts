import './env';
import { randomUUID } from 'node:crypto';
import { admin } from '../src/server/supabase';
// Supply environment variables through your shell or a private secret manager.
const email = process.env.ACCORD_OWNER_EMAIL,
  password = process.env.ACCORD_OWNER_PASSWORD,
  name = process.env.ACCORD_OWNER_NAME ?? 'Workspace owner';
if (!email || !password || password.length < 12)
  throw new Error('Set ACCORD_OWNER_EMAIL and ACCORD_OWNER_PASSWORD (at least 12 characters).');
const db = admin();
const { count, error: check } = await db
  .from('workspaces')
  .select('id', { head: true, count: 'exact' });
if (check) throw new Error('Migrations must be applied before bootstrap.');
if (count)
  throw new Error('This installation already has an owner; bootstrap will not replace it.');
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) throw new Error('Owner auth account could not be created.');
const workspaceId = randomUUID(),
  identityId = randomUUID();
const { error: install } = await db.rpc('accord_bootstrap', {
  p_workspace: workspaceId,
  p_identity: identityId,
  p_auth_user: data.user.id,
  p_name: name,
});
if (install) {
  const { error: cleanup } = await db.auth.admin.deleteUser(data.user.id);
  if (cleanup)
    throw new Error(
      'Bootstrap failed and the uninstalled auth account could not be removed. Inspect the selected project before retrying.',
    );
  throw new Error('Bootstrap transaction failed; created auth account was removed.');
}
console.log(
  'Owner installed. Sign in to Accord. Public signup must remain disabled in the Supabase dashboard.',
);
