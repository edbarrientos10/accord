'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import type { Project } from '../../domain/types';

type Preferences = { favorites: string[]; collapsed: boolean };
const empty: Preferences = { favorites: [], collapsed: false };
function parse(value: string | null): Preferences {
  try {
    const data: unknown = JSON.parse(value ?? 'null');
    if (!data || typeof data !== 'object') return empty;
    const candidate = data as Partial<Preferences>;
    return {
      favorites: Array.isArray(candidate.favorites)
        ? [
            ...new Set(
              candidate.favorites.filter((id): id is string => typeof id === 'string' && !!id),
            ),
          ]
        : [],
      collapsed: candidate.collapsed === true,
    };
  } catch {
    return empty;
  }
}
const Context = createContext<{
  favorites: string[];
  collapsed: boolean;
  ready: boolean;
  toggleFavorite: (id: string) => void;
  toggleCollapsed: () => void;
} | null>(null);

export function ProjectPreferencesProvider({
  storageKey,
  children,
}: {
  storageKey: string;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(empty);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setPreferences(parse(localStorage.getItem(storageKey)));
    } catch {
      setPreferences(empty);
    }
    setReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setPreferences(event.key === null ? empty : parse(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);
  const update = (next: Preferences) => {
    if (!ready) return;
    setPreferences(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Keep preferences usable when storage is unavailable. */
    }
  };
  return (
    <Context.Provider
      value={{
        ...preferences,
        ready,
        toggleFavorite: (id) =>
          update({
            ...preferences,
            favorites: preferences.favorites.includes(id)
              ? preferences.favorites.filter((value) => value !== id)
              : [...preferences.favorites, id],
          }),
        toggleCollapsed: () => update({ ...preferences, collapsed: !preferences.collapsed }),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useProjectPreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('Project preferences provider missing');
  return value;
}

export function FavoriteProjectButton({ project }: { project: Project }) {
  const { favorites, ready, toggleFavorite } = useProjectPreferences();
  const favorite = favorites.includes(project.id);
  const label = `${favorite ? 'Remove' : 'Add'} ${project.name} ${favorite ? 'from' : 'to'} favorites`;
  return (
    <button
      type="button"
      className="icon-button project-favorite"
      aria-label={label}
      title={label}
      aria-pressed={favorite}
      disabled={!ready}
      onClick={() => toggleFavorite(project.id)}
    >
      <Star size={18} fill={favorite ? 'currentColor' : 'none'} />
    </button>
  );
}
