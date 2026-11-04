'use client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { defaultGroups } from '../../domain/people-schema';
import type { State } from '../../domain/types';
import type { FormSpec } from '../forms';
import { CommandForm } from '../forms';
import { ProjectPreferencesProvider } from './project-preferences';
import { Login } from '../features/login';
import { auth } from './helpers';
interface Credential {
  id: string;
  identity_id: string;
  version: number;
  scopes: string[];
  assignments: string[];
  access_mode?: 'assigned' | 'workspace';
  expires_at: string;
  revoked_at: string | null;
}
function useWorkspaceData() {
  const [state, setState] = useState<State>(),
    [demo, setDemo] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [token, setToken] = useState(''),
    [actorId, setActorId] = useState(''),
    [notice, setNotice] = useState(''),
    [form, setForm] = useState<FormSpec>(),
    [credentials, setCredentials] = useState<Credential[]>([]),
    [newToken, setNewToken] = useState(''),
    [loggingOut, setLoggingOut] = useState(false);
  const sessionEpoch = useRef(0),
    signingOut = useRef(false),
    reloadSequence = useRef(0),
    mutations = useRef(0);
  const clearSession = useCallback(() => {
    sessionEpoch.current++;
    setToken('');
    setActorId('');
    setState(undefined);
    setCredentials([]);
    setNewToken('');
    setForm(undefined);
    setNotice('');
    setError('');
    retryKeys.current.clear();
    setPending(false);
  }, []);
  const logout = async () => {
    if (demo || signingOut.current) return;
    signingOut.current = true;
    sessionEpoch.current++;
    setLoggingOut(true);
    try {
      const client = auth();
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      // This SDK clears local storage even when signOut returns a server error.
      // Revoke first without changing local state, so failures remain retryable.
      if (data.session) {
        const { error } = await client.auth.admin.signOut(data.session.access_token, 'local');
        if (error && ![401, 403, 404].includes(error.status ?? 0)) throw error;
      }
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) {
        const { data: remaining } = await client.auth.getSession();
        if (remaining.session) throw error;
      }
      clearSession();
    } catch (e) {
      setNotice(`Could not log out: ${(e as Error).message}. Please try again.`);
    } finally {
      signingOut.current = false;
      setLoggingOut(false);
    }
  };
  const pathname = usePathname();
  const request = useCallback(
    async (path: string, options: RequestInit = {}, bearer = token) => {
      const epoch = sessionEpoch.current;
      if (signingOut.current) throw new DOMException('Session is closing.', 'AbortError');
      const response = await fetch(path, {
        ...options,
        headers: { ...options.headers, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      });
      const data = await response.json();
      if (epoch !== sessionEpoch.current) throw new DOMException('Session changed.', 'AbortError');
      if (!response.ok)
        throw new Error(data.error?.message ?? 'The request could not be completed.');
      return data;
    },
    [token],
  );
  const reload = useCallback(
    async (bearer = token, signal?: AbortSignal) => {
      const epoch = sessionEpoch.current;
      const sequence = ++reloadSequence.current;
      const data = await request(
        '/api/v1/state?history=none',
        { cache: 'no-store', signal },
        bearer,
      );
      if (
        epoch !== sessionEpoch.current ||
        signingOut.current ||
        signal?.aborted ||
        sequence !== reloadSequence.current
      )
        return;
      const next: State = {
        ...data.state,
        timezone: data.state.timezone ?? 'America/Monterrey',
        people: data.state.people ?? [],
        relationshipGroups: data.state.relationshipGroups ?? defaultGroups(),
        interactions: data.state.interactions ?? [],
        importantDates: data.state.importantDates ?? [],
        commitments: data.state.commitments ?? [],
        peopleResponses: data.state.peopleResponses ?? [],
        projects: data.state.projects ?? [],
        decisions: data.state.decisions ?? [],
        reminders: data.state.reminders ?? [],
      };
      setState((current) => {
        // Unchanged snapshots should not reset editors or reload dependent views.
        if (current?.workspaceId === next.workspaceId && current.revision >= next.revision)
          return current;
        return next;
      });
      setActorId(data.actor?.id ?? 'preview');
      setDemo(Boolean(data.demo));
      setError('');
    },
    [request, token],
  );
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    async function start() {
      let t = '';
      try {
        const client = auth();
        const epoch = sessionEpoch.current;
        const { data } = await client.auth.getSession();
        if (!alive || epoch !== sessionEpoch.current) return;
        t = data.session?.access_token ?? '';
        const listener = client.auth.onAuthStateChange((event, session) => {
          if (!alive) return;
          if (event === 'SIGNED_OUT') clearSession();
          else if (!signingOut.current) setToken(session?.access_token ?? '');
        });
        unsubscribe = () => listener.data.subscription.unsubscribe();
      } catch {}
      if (!alive) return;
      setToken(t);
      try {
        await reload(t);
      } catch (e) {
        if (alive && (e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void start();
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    if (token)
      void reload(token).catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
  }, [token]);
  const workspaceId = state?.workspaceId;
  useEffect(() => {
    if (!workspaceId || loading || demo) return;
    let active: AbortController | undefined;
    const refresh = async () => {
      if (
        document.visibilityState !== 'visible' ||
        active ||
        signingOut.current ||
        mutations.current > 0
      )
        return;
      const controller = new AbortController();
      active = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        await reload(token, controller.signal);
      } catch {
        // Keep the last usable snapshot during transient failures; retry next tick.
      } finally {
        clearTimeout(timeout);
        active = undefined;
      }
    };
    const onResume = () => void refresh();
    const timer = setInterval(onResume, 5000);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    return () => {
      clearInterval(timer);
      active?.abort();
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
    };
  }, [workspaceId, loading, demo, token, reload]);
  useEffect(() => {
    if (pathname.startsWith('/agents') && token && !demo)
      void request('/api/v1/credentials')
        .then((d) => setCredentials(d.credentials))
        .catch((e) => {
          if (e.name !== 'AbortError') setNotice(e.message);
        });
  }, [pathname, token, demo, state?.revision, request]);
  useEffect(() => {
    setNewToken('');
    setForm(undefined);
    setNotice('');
  }, [pathname]);
  const retryKeys = useRef(new Map<string, string>()),
    [pending, setPending] = useState(false);
  const run = async (name: string, input: unknown, throwOnError = false) => {
    const epoch = sessionEpoch.current;
    if (demo) {
      setNotice('This is a fictional, read-only preview. Connect your workspace to save changes.');
      return false;
    }
    const signature = JSON.stringify({ name, input });
    let key = retryKeys.current.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      retryKeys.current.set(signature, key);
    }
    mutations.current++;
    reloadSequence.current++;
    setPending(true);
    try {
      await request(`/api/v1/commands/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(input),
      });
      await reload();
      if (epoch !== sessionEpoch.current) return false;
      retryKeys.current.delete(signature);
      setNotice('Saved.');
      return true;
    } catch (e) {
      if (epoch === sessionEpoch.current) setNotice((e as Error).message);
      if (throwOnError) throw e;
      return false;
    } finally {
      mutations.current--;
      setPending(false);
    }
  };
  return {
    run,
    logout,
    loggingOut,
    actorId,
    pending,
    state,
    demo,
    loading,
    error,
    setError,
    token,
    setToken,
    notice,
    setNotice,
    form,
    setForm,
    credentials,
    newToken,
    setNewToken,
    request,
    reload,
  };
}
type WorkspaceValue = Omit<ReturnType<typeof useWorkspaceData>, 'state'> & { state: State };
const Context = createContext<WorkspaceValue | null>(null);
export function useWorkspace() {
  const c = useContext(Context);
  if (!c) throw new Error('Workspace provider missing');
  return c;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useWorkspaceData(),
    pathname = usePathname();
  if (value.loading)
    return (
      <main className="loading">
        <img
          className="brand-symbol"
          src="/brand/accord-icon-48-v2.png"
          alt="Accord"
          width={36}
          height={36}
        />
        <p>
          Opening your workspace<span className="loading-dots">…</span>
        </p>
      </main>
    );
  if (!value.state || pathname === '/reset-password')
    return (
      <Login
        error={value.error}
        reset={pathname === '/reset-password'}
        onLogin={async (t) => {
          value.setToken(t);
          await value.reload(t);
        }}
      />
    );
  return (
    <Context.Provider value={{ ...value, state: value.state }}>
      <ProjectPreferencesProvider
        key={`${value.state.workspaceId}:${value.actorId}`}
        storageKey={`accord:project-preferences:v1:${value.state.workspaceId}:${value.actorId}`}
      >
        {children}
        {value.form && (
          <CommandForm
            key={value.form.title}
            spec={value.form}
            onClose={() => value.setForm(undefined)}
          />
        )}
      </ProjectPreferencesProvider>
    </Context.Provider>
  );
}
