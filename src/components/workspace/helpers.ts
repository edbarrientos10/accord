import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Field } from '../forms';
let authClient: SupabaseClient | undefined;
export function auth() {
  if (!authClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase is not configured. Follow the installation guide.');
    authClient = createClient(url, key);
  }
  return authClient;
}
export const fmt = (v: string) =>
  new Date(v).toLocaleDateString('en', { month: 'short', day: 'numeric' });
export const datetime = (v?: string) => {
  const d = new Date(v ?? Date.now() + 7 * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const iso = (f: FormData, key: string) => new Date(String(f.get(key))).toISOString();
export const str = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
export const lines = (f: FormData, key: string) =>
  str(f, key)
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
export const reason: Field = {
  name: 'reason',
  label: 'Reason for this change',
  value: 'Record the next step and preserve continuity',
};
