import { useEffect, useState } from 'react';

// The one place the light/dark choice lives, so every page follows it: the login page, the signed-in
// app and the public signing page. index.html applies the saved theme before the first paint.

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'quicksign_theme_v2';
const CHANGE_EVENT = 'quicksign-theme-change';

export function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark'; // Dark mode by default
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#09090b' : '#fafafa');
}

/** The current theme, kept in sync across pages and open tabs. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    const sync = () => {
      const current = readTheme();
      applyTheme(current);
      setThemeState(current);
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync); // another tab changed it
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggleTheme = () => {
    try {
      localStorage.setItem(STORAGE_KEY, readTheme() === 'dark' ? 'light' : 'dark');
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return { theme, toggleTheme };
}
