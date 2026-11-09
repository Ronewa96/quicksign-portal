import React from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../common/Avatar';
import { Sun, Moon, ArrowUpRight, LogOut, Menu } from 'lucide-react';

export const Header: React.FC<{ onMenuClick?: () => void }> = ({ onMenuClick }) => {
  const { theme, toggleTheme, activeView, setActiveView, userProfile } = useDocuments();
  const { logout, user } = useAuth();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 sm:gap-6 px-3 sm:px-6 py-3 sm:py-3.5 border-b border-zinc-800/90 bg-zinc-950/95 backdrop-blur-md transition-colors">
      {/* Zone 1: Menu button (phones) + wordmark */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-1 rounded-md text-zinc-300 hover:text-white hover:bg-zinc-800/60 cursor-pointer"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <button
          onClick={() => setActiveView('dashboard')}
          className="flex items-center gap-2.5 text-left group cursor-pointer focus-visible:outline-none"
        >
          <div className="w-8 h-8 rounded bg-white flex items-center justify-center text-zinc-950 font-bold text-sm tracking-wider font-display shadow-sm">
            QS
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight text-zinc-100 font-display whitespace-nowrap">
              QuickSign <span className="hidden sm:inline text-zinc-500 font-normal">Portal</span>
            </span>
          </div>
        </button>
      </div>

      {/* Zone 2: Clean single-line text navigation links */}
      <nav className="hidden xl:flex items-center gap-7 text-sm font-medium">
        <button
          onClick={() => setActiveView('dashboard')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeView === 'dashboard'
              ? 'text-white font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Dashboard
        </button>

        <button
          onClick={() => setActiveView('send')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeView === 'send'
              ? 'text-white font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Send to Sign
        </button>

        <button
          onClick={() => setActiveView('viewer')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeView === 'viewer'
              ? 'text-white font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Viewer
        </button>

        <button
          onClick={() => setActiveView('convert')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeView === 'convert'
              ? 'text-white font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Convert
        </button>

        <button
          onClick={() => setActiveView('ai')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeView === 'ai'
              ? 'text-white font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          AI Assistant
        </button>

        <button
          onClick={() => setActiveView('audit')}
          className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeView === 'audit'
              ? 'text-white font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Audit Trail
        </button>
      </nav>

      {/* Zone 3: 1 primary action button + utility controls */}
      <div className="flex items-center gap-1 sm:gap-3 shrink-0">
        {/* Subtle Theme Toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors cursor-pointer"
          aria-label="Toggle visual theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Profile Button (photo only on phones) */}
        <button
          onClick={() => setActiveView('settings')}
          title="Profile & Settings"
          aria-label="Profile & Settings"
          className="flex items-center gap-2 p-1 sm:pl-1.5 sm:pr-3 sm:py-1 rounded-full sm:rounded-md text-xs font-medium text-zinc-300 hover:bg-zinc-800/60 sm:border border-zinc-800 transition-colors cursor-pointer"
        >
          <Avatar src={user?.avatarUrl} initials={userProfile.savedInitials || 'AM'} size={26} />
          <span className="hidden sm:inline truncate max-w-[100px]">{userProfile.name}</span>
        </button>

        {/* Sign Out */}
        <button
          onClick={logout}
          title="Sign out"
          aria-label="Sign out"
          className="p-2 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/60 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>

        {/* Primary Action Button */}
        <button
          onClick={() => setActiveView('send')}
          aria-label="Send to Sign"
          className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 text-xs font-medium tracking-tight text-zinc-950 bg-zinc-100 rounded-md hover:bg-white transition-all shadow-sm active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span className="hidden sm:inline">Send to Sign</span>
          <ArrowUpRight className="w-3.5 h-3.5 opacity-80" />
        </button>
      </div>
    </header>
  );
};
