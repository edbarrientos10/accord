'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from './context';
import type { LogPage } from '../../domain/logs';
export function useLogPage(query: string, live = false) {
  const { request } = useWorkspace();
  const [page, setPage] = useState<LogPage>({ items: [], nextCursor: null }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [checked, setChecked] = useState<string>();
  const controller = useRef<AbortController | null>(null),
    sequence = useRef(0),
    busy = useRef(false);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const seq = ++sequence.current;
    busy.current = true;
    setLoading(true);
    try {
      const result = await request('/api/v1/logs?' + query, { signal: c.signal });
      if (seq === sequence.current) {
        setPage(result);
        setError('');
        setChecked(new Date().toISOString());
      }
    } catch (e) {
      if (!c.signal.aborted && seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) {
        setLoading(false);
        busy.current = false;
      }
    }
  }, [query, request]);
  useEffect(() => {
    // Debounce search/filter edits; cancel obsolete requests, never append unbounded history.
    const timer = setTimeout(() => void refresh(), 200);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
      sequence.current++;
      busy.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy.current) void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [live, refresh]);
  return { page, loading, error, checked, refresh };
}
