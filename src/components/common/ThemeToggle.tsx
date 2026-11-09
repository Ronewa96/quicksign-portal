import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../lib/theme';

/** Light/dark switch for pages outside the signed-in app (login, public signing). */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      aria-label="Toggle visual theme"
      className={`p-2 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors cursor-pointer ${className}`}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};
