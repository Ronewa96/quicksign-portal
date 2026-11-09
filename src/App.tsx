import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DocumentProvider, useDocuments } from './context/DocumentContext';
import { LoginPage } from './components/auth/LoginPage';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/dashboard/Dashboard';
import { DedicatedSigningPage } from './components/signing/DedicatedSigningPage';
import { PublicSigningPage } from './components/signing/PublicSigningPage';
import { DocumentViewer } from './components/viewer/DocumentViewer';
import { DocumentConverter } from './components/converter/DocumentConverter';
import { AIAssistant } from './components/ai/AIAssistant';
import { AuditTrace } from './components/audit/AuditTrace';
import { SettingsView } from './components/settings/SettingsView';
import { SendDocumentView } from './components/send/SendDocumentView';

const MainLayout: React.FC = () => {
  const { activeView } = useDocuments();
  // Phone menu (the sidebar slides in as a drawer below the md breakpoint)
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // If in dedicated signing mode, render full-screen distraction-free experience
  if (activeView === 'dedicatedSign') {
    return <DedicatedSigningPage />;
  }

  return (
    // h-dvh follows the visible height on mobile browsers (address bar shown/hidden)
    <div className="flex flex-col h-dvh w-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans antialiased">
      {/* Top bar */}
      <Header onMenuClick={() => setIsMenuOpen(true)} />

      {isMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setIsMenuOpen(false)} />
          <div className="relative h-full shadow-2xl">
            <Sidebar variant="drawer" onNavigate={() => setIsMenuOpen(false)} />
            <button
              onClick={() => setIsMenuOpen(false)}
              className="absolute top-3 -right-11 p-2 rounded-full bg-zinc-900 text-zinc-200 cursor-pointer"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar and main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />

        <main className="flex-1 flex flex-col min-h-0 bg-zinc-950 overflow-hidden">
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'send' && <SendDocumentView />}
          {activeView === 'viewer' && <DocumentViewer />}
          {activeView === 'convert' && <DocumentConverter />}
          {activeView === 'ai' && <AIAssistant />}
          {activeView === 'audit' && <AuditTrace />}
          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
};

const AuthGate: React.FC = () => {
  const { user, isLoading } = useAuth();
  // Opened from a "reset your password" email: show the new-password form even if signed in
  const [resetToken, setResetToken] = useState(() =>
    window.location.pathname === '/reset-password' ? new URLSearchParams(window.location.search).get('token') || '' : null
  );

  if (isLoading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-zinc-950 text-zinc-500">
        <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!user || resetToken !== null) {
    return (
      <LoginPage
        resetToken={resetToken}
        onResetFinished={() => {
          window.history.replaceState(null, '', '/');
          setResetToken(null);
        }}
      />
    );
  }

  // Keyed by user so all per-account state resets cleanly on account switch
  return (
    <DocumentProvider key={user.id} authUser={user}>
      <MainLayout />
    </DocumentProvider>
  );
};

// Signing links from emails (/sign/<token>) work without an account
const signLinkToken = window.location.pathname.match(/^\/sign\/([a-f0-9]{48})\/?$/)?.[1];

export default function App() {
  if (signLinkToken) {
    return <PublicSigningPage token={signLinkToken} />;
  }

  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
