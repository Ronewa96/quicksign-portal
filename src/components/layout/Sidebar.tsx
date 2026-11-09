import React, { useState } from 'react';
import { useDocuments, NavigationTab } from '../../context/DocumentContext';
import {
  LayoutDashboard,
  Send,
  Eye,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Settings,
  FileCheck2,
  PenTool,
} from 'lucide-react';

interface SidebarProps {
  /** 'rail': hover-to-expand icon strip (tablet/desktop). 'drawer': full menu in the phone slide-out panel. */
  variant?: 'rail' | 'drawer';
  /** Called after any navigation, e.g. to close the phone menu */
  onNavigate?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ variant = 'rail', onNavigate }) => {
  const { activeView, setActiveView, documents, activeDocumentId, setActiveDocumentId, openDedicatedSigning } = useDocuments();

  // Collapsed to an icon rail by default; expands while hovered.
  // Clicking any item navigates and collapses until the pointer re-enters.
  const [isExpanded, setIsExpanded] = useState(false);
  const isDrawer = variant === 'drawer';
  const expanded = isDrawer || isExpanded;

  const collapse = () => {
    setIsExpanded(false);
    onNavigate?.();
  };

  const pendingCount = documents.filter((d) => d.status === 'pending').length;

  const navItems: Array<{ id: NavigationTab; label: string; icon: any; badge?: number }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'send', label: 'Send to Sign', icon: Send, badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'viewer', label: 'Document Viewer', icon: Eye },
    { id: 'convert', label: 'Converter', icon: RefreshCw },
    { id: 'ai', label: 'AI Assistant', icon: Sparkles },
    { id: 'audit', label: 'Audit Trail', icon: ShieldCheck },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const navigate = (view: NavigationTab) => {
    setActiveView(view);
    collapse();
  };

  // Fades labels out when the rail is collapsed while keeping icons fixed in place
  const labelClass = `whitespace-nowrap transition-opacity duration-150 ${expanded ? 'opacity-100' : 'opacity-0'}`;

  const railHandlers = isDrawer
    ? {}
    : {
        onMouseEnter: () => setIsExpanded(true),
        onMouseLeave: () => setIsExpanded(false),
        onFocus: () => setIsExpanded(true),
        onBlur: (e: React.FocusEvent<HTMLElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsExpanded(false);
        },
      };

  return (
    // Rail: fixed-width placeholder keeps content from shifting; the panel overlays it when expanded.
    // Hidden on phones, where the same menu opens as a drawer from the header.
    <div className={isDrawer ? 'h-full' : 'hidden md:block relative w-16 shrink-0'}>
      <aside
        {...railHandlers}
        className={`flex flex-col overflow-hidden border-r border-zinc-800/80 bg-zinc-950 select-none ${
          isDrawer
            ? 'h-full w-72 max-w-[85vw]'
            : `absolute inset-y-0 left-0 z-30 transition-[width,box-shadow] duration-200 ease-out ${
                isExpanded ? 'w-64 shadow-2xl shadow-black/50' : 'w-16'
              }`
        }`}
      >
        {/* Primary Action Button */}
        <div className="p-3 border-b border-zinc-800/60">
          <button
            onClick={() => {
              const pendingDoc = documents.find((d) => d.status === 'pending') || documents[0];
              if (pendingDoc) {
                openDedicatedSigning(pendingDoc.id);
              } else {
                setActiveView('send');
              }
              collapse();
            }}
            title="Sign Document Now"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md bg-zinc-100 text-zinc-950 text-xs font-semibold tracking-tight hover:bg-white transition-all shadow-sm active:scale-[0.99] cursor-pointer"
          >
            <PenTool className="w-3.5 h-3.5 shrink-0 text-cyan-600" />
            {expanded && <span className="whitespace-nowrap">Sign Document Now</span>}
          </button>
        </div>

        {/* Main Navigation links */}
        <div className="flex-1 min-h-0 py-4 px-3 space-y-1 flex flex-col">
          <div className={`px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 ${labelClass}`}>
            Menu
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                title={item.label}
                className={`relative w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer group ${
                  isActive
                    ? 'bg-zinc-800/80 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive
                        ? 'text-zinc-100'
                        : 'text-zinc-500 group-hover:text-zinc-300'
                    }`}
                  />
                  <span className={`truncate ${labelClass}`}>{item.label}</span>
                </div>
                {item.badge !== undefined &&
                  (expanded ? (
                    <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400">
                      {item.badge}
                    </span>
                  ) : (
                    <span className="absolute top-1.5 left-7 w-1.5 h-1.5 rounded-full bg-cyan-500" />
                  ))}
              </button>
            );
          })}

          {/* Quick Documents Queue — only shown when expanded */}
          <div className={`flex-1 min-h-0 flex flex-col ${expanded ? '' : 'invisible'}`}>
            <div className={`pt-6 px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 flex items-center justify-between ${labelClass}`}>
              <span>Your Documents</span>
              <span className="text-[10px] font-mono tabular-nums text-zinc-400">{documents.length}</span>
            </div>

            <div className={`space-y-0.5 overflow-y-auto max-h-[38vh] pr-1 ${labelClass}`}>
              {documents.map((doc) => {
                const isCurrent = doc.id === activeDocumentId;
                return (
                  <button
                    key={doc.id}
                    onClick={() => {
                      setActiveDocumentId(doc.id);
                      if (activeView === 'dashboard') {
                        setActiveView('viewer');
                      }
                      collapse();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors cursor-pointer block ${
                      isCurrent
                        ? 'bg-zinc-800/50 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-900/60'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      <FileCheck2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          doc.status === 'completed'
                            ? 'text-emerald-500'
                            : doc.status === 'pending'
                            ? 'text-cyan-500'
                            : 'text-zinc-400'
                        }`}
                      />
                      <span className="truncate">{doc.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500 font-mono tabular-nums">
                      <span className="capitalize">{doc.status}</span>
                      <span aria-hidden="true">·</span>
                      <span>{doc.pages.length}p</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Status indicator */}
        <div className="px-6 py-3 border-t border-zinc-800/60 bg-zinc-950/40">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-500"></span>
              <span className={labelClass}>Signing service</span>
            </span>
            <span className={`font-mono text-[10px] text-zinc-400 ${labelClass}`}>Online</span>
          </div>
        </div>
      </aside>
    </div>
  );
};
