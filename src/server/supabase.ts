import { createClient } from '@supabase/supabase-js';
import { DomainError } from '../domain/errors';
export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new DomainError(
      'not_configured',
      'Complete the Supabase installation before signing in.',
      503,
    );
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
