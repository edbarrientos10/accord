'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'system' | 'light' | 'dark';
const storageKey = 'accord.theme.v1';
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

function parseTheme(value: string | null | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.themePreference = theme;
  root.dataset.theme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setPreference] = useState<Theme>('system');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const initial = parseTheme(document.documentElement.dataset.themePreference);
    setPreference(initial);
    applyTheme(initial);

    const onSystemChange = () => {
      applyTheme(parseTheme(document.documentElement.dataset.themePreference));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const next = parseTheme(event.newValue);
      setPreference(next);
      applyTheme(next);
    };
    media.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function setTheme(next: Theme) {
    setPreference(next);
    applyTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The current page still works when browser storage is unavailable.
    }
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemeSetting() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeSetting requires ThemeProvider');
  return (
    <section className="section">
      <h2>Appearance</h2>
      <p className="muted" id="theme-description">
        Follow your system appearance or choose a theme. Saved in this browser.
      </p>
      <label className="theme-setting">
        Theme
        <select
          value={context.theme}
          aria-describedby="theme-description"
          onChange={(event) => context.setTheme(parseTheme(event.target.value))}
        >
          <option value="system">System (default)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </section>
  );
}
