import { it, expect, vi } from 'vitest';
import { fixture } from './helpers';
import { GET as listGET } from '../src/app/api/v1/logs/route';
import { GET as detailGET } from '../src/app/api/v1/logs/[id]/route';
import { GET as stateGET } from '../src/app/api/v1/state/route';
import { fixtureLogSummaries, encodeCursor } from '../src/domain/logs';
import { SupabaseRepository } from '../src/server/repository';
import type { Actor } from '../src/domain/types';
const env = vi.hoisted(() => ({ actor: null as Actor | null, db: {} as Record<string, unknown> }));
vi.mock('../src/server/auth', () => ({ authenticate: async () => env.actor }));
vi.mock('../src/server/supabase', () => ({ admin: () => env.db }));
it('serves bounded owner-only pages and one detail scoped to the authenticated workspace', async () => {
  const f = fixture();
  f.create();
  env.actor = f.human;
  const rows = Array.from({ length: 51 }, (_, i) => ({
    ...fixtureLogSummaries(f.state)[0],
    id: crypto.randomUUID(),
    reason: `Reason ${i}`,
  }));
  let calls = 0,
    params: Record<string, unknown> = {};
  env.db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls++;
      expect(name).toBe('accord_activity_page');
      params = args;
      return { data: rows };
    },
  };
  const response = await listGET(new Request('http://localhost/api/v1/logs?actor=all'));
  const result = await response.json();
  expect(result.items).toHaveLength(50);
  expect(result.nextCursor).toBe(encodeCursor(rows[49]));
  expect(params.p_workspace).toBe(f.state.workspaceId);
  expect(JSON.stringify(result)).not.toContain('changes');
  expect((await listGET(new Request('http://localhost/api/v1/logs?limit=100000'))).status).toBe(
    400,
  );
  expect(calls).toBe(1);
  expect((await listGET(new Request('http://localhost/api/v1/logs?cursor=bad'))).status).toBe(400);
  env.actor = f.agent;
  expect((await listGET(new Request('http://localhost/api/v1/logs'))).status).toBe(403);
  expect(calls).toBe(1);
  env.actor = f.human;
  env.db = {
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (key: string, val: string) => {
          filters[key] = val;
          return q;
        },
        maybeSingle: async () => {
          expect(filters.workspace_id).toBe(f.state.workspaceId);
          if (filters.id !== rows[0].id) return { data: null };
          return {
            data:
              table === 'activity_log'
                ? { summary: rows[0], kind: 'change', detail: null }
                : {
                    body: {
                      ...f.state.audit[0],
                      changes: {
                        before: null,
                        after: { name: 'Safe', authUserId: 'private-auth', token: 'private-token' },
                      },
                    },
                  },
          };
        },
      };
      return q;
    },
  };
  const detail = await detailGET(new Request('http://localhost'), {
    params: Promise.resolve({ id: rows[0].id }),
  });
  expect(detail.status).toBe(200);
  expect(JSON.stringify(await detail.json())).not.toMatch(/private-auth|private-token/);
  expect(
    (
      await detailGET(new Request('http://localhost'), {
        params: Promise.resolve({ id: crypto.randomUUID() }),
      })
    ).status,
  ).toBe(404);
});
it('uses the compact snapshot for UI reads and only sends new audit events to commit', async () => {
  const f = fixture();
  f.create();
  env.actor = f.human;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  env.db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data:
          name === 'accord_commit'
            ? { result: { id: f.state.workstreams[0].id } }
            : { ...f.state, audit: name === 'accord_current_snapshot' ? [] : f.state.audit },
      };
    },
  };
  const response = await stateGET(new Request('http://localhost/api/v1/state?history=none'));
  expect((await response.json()).state.audit).toEqual([]);
  expect(calls[0].name).toBe('accord_current_snapshot');
  const repo = new SupabaseRepository();
  const after = structuredClone(f.state);
  after.audit.push({ ...after.audit[0], id: crypto.randomUUID(), reason: 'New event' });
  await repo.commit(f.human, 'test-key', 'hash', f.state, after, {});
  expect((calls.at(-1)!.args.p_state as typeof f.state).audit).toHaveLength(1);
});
