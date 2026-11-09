import React, { useEffect, useState } from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { SentRequests } from './SentRequests';
import {
  FileText,
  PenTool,
  Send,
  Eye,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  Filter,
  Trash2,
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const {
    documents,
    setActiveView,
    setActiveDocumentId,
    openDedicatedSigning,
    userProfile,
    deleteDocument,
    clearDocuments,
  } = useDocuments();

  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'draft'>('all');

  const pendingDocs = documents.filter((d) => d.status === 'pending');
  const completedDocs = documents.filter((d) => d.status === 'completed' || d.status === 'signed');

  // The cards count documents sent for signing (on the server) as well as those on this device
  const [sentStatuses, setSentStatuses] = useState<string[]>([]);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/requests')
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data) => setSentStatuses((data.requests || []).map((r: { status: string }) => r.status)))
      .catch(() => setSentStatuses([]));
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setAiConfigured(data ? Boolean(data.aiConfigured) : null))
      .catch(() => setAiConfigured(null));
  }, []);

  const openSigning = () => {
    const target = pendingDocs[0] || documents[0];
    if (target) openDedicatedSigning(target.id);
    else setActiveView('send'); // nothing to sign yet, so start with a document
  };

  const filteredDocs = documents.filter((d) => {
    if (filter === 'all') return true;
    if (filter === 'completed') return d.status === 'completed' || d.status === 'signed';
    return d.status === filter;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-y-auto">
      {/* Hero Welcome Banner */}
      <div className="px-4 sm:px-8 py-6 sm:py-8 border-b border-zinc-800/80 bg-zinc-950/60">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-400 mb-1">
              DOCUMENT SIGNING MADE SIMPLE
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white font-display">
              Welcome back, {userProfile.name}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Upload documents, sign them, send them to others, and keep track of every step.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveView('send')}
              className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5 text-cyan-400" />
              <span>Send to Sign</span>
            </button>

            <button
              onClick={openSigning}
              className="flex items-center gap-1.5 px-4 py-2 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs rounded transition-all cursor-pointer shadow-sm whitespace-nowrap"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Sign a Document</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-70" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl w-full mx-auto p-4 sm:p-8 space-y-8">
        {/* Metric Cards Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="text-xs text-zinc-400">Total Documents</div>
            <div className="text-2xl font-bold text-white font-mono mt-1 tabular-nums">
              {documents.length + sentStatuses.length}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">All documents</div>
          </div>

          <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="text-xs text-cyan-400">Awaiting Signature</div>
            <div className="text-2xl font-bold text-cyan-300 font-mono mt-1 tabular-nums">
              {pendingDocs.length + sentStatuses.filter((s) => s === 'pending').length}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Waiting for signatures</div>
          </div>

          <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="text-xs text-emerald-400">Signed</div>
            <div className="text-2xl font-bold text-emerald-300 font-mono mt-1 tabular-nums">
              {completedDocs.length + sentStatuses.filter((s) => s === 'completed').length}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Fully signed</div>
          </div>

          <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="text-xs text-zinc-400">AI Assistant</div>
            <div className="text-2xl font-bold text-white font-mono mt-1 tabular-nums">
              {aiConfigured === false ? 'Basic' : 'Ready'}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">
              {aiConfigured === false ? 'Keyword check, no AI key' : 'Summaries and Q&A'}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={openSigning}
            className="p-5 bg-zinc-950 border border-zinc-800/80 hover:border-cyan-500/50 rounded-lg text-left transition-all cursor-pointer group"
          >
            <div className="w-8 h-8 rounded bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <PenTool className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white font-display group-hover:text-cyan-300 transition-colors">
              Sign a Document
            </h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Place your signature, the date, and your name on the page with drag and drop.
            </p>
          </button>

          <button
            onClick={() => setActiveView('viewer')}
            className="p-5 bg-zinc-950 border border-zinc-800/80 hover:border-zinc-700 rounded-lg text-left transition-all cursor-pointer group"
          >
            <div className="w-8 h-8 rounded bg-zinc-900 text-zinc-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Eye className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white font-display group-hover:text-zinc-200 transition-colors">
              View Documents
            </h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Open and read your documents, with zoom, page navigation, and search.
            </p>
          </button>

          <button
            onClick={() => setActiveView('convert')}
            className="p-5 bg-zinc-950 border border-zinc-800/80 hover:border-zinc-700 rounded-lg text-left transition-all cursor-pointer group"
          >
            <div className="w-8 h-8 rounded bg-zinc-900 text-zinc-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <RefreshCw className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white font-display group-hover:text-zinc-200 transition-colors">
              Convert Files
            </h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Convert documents between PDF, Word, Markdown, text, HTML, and JSON, then download the result.
            </p>
          </button>
        </div>

        {/* Documents sent to other people, with signing progress */}
        <SentRequests />

        {/* Documents Table */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          {/* Table Header Controls */}
          <div className="p-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900/40">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-display">
                Your Documents
              </h3>
            </div>

            <div className="flex items-center gap-3">
            {documents.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm(`Delete all ${documents.length} documents? This cannot be undone.`)) {
                    clearDocuments();
                  }
                }}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete all</span>
              </button>
            )}

            {/* Filter buttons */}
            <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-800">
              {(['all', 'pending', 'completed', 'draft'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer capitalize ${
                    filter === tab
                      ? 'bg-zinc-800 text-white font-medium shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            </div>
          </div>

          {/* Table Content */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/60 text-zinc-400 text-[11px] font-mono uppercase tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4 font-medium">Document Title</th>
                  <th className="py-3 px-4 font-medium">Category</th>
                  <th className="py-3 px-4 font-medium">Signers</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Transaction ID</th>
                  <th className="py-3 px-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {filteredDocs.map((d) => (
                  <tr key={d.id} className="hover:bg-zinc-900/40 transition-colors">
                    <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="truncate">{d.title}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-zinc-400 max-w-40 truncate">
                      {d.category}
                    </td>

                    <td className="py-3.5 px-4 text-zinc-300">
                      <div className="text-xs">
                        {d.signers.map((s) => s.name).join(', ')}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`font-mono text-[11px] uppercase font-semibold ${
                          d.status === 'completed'
                            ? 'text-emerald-400'
                            : d.status === 'pending'
                            ? 'text-cyan-400'
                            : 'text-zinc-400'
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-400">
                      {d.transactionId ? (
                        <span className="text-cyan-400/90">{d.transactionId}</span>
                      ) : (
                        <span className="text-zinc-600">Pending</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setActiveDocumentId(d.id);
                            setActiveView('viewer');
                          }}
                          className="px-2 py-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                          title="View Document"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => {
                            setActiveDocumentId(d.id);
                            setActiveView('ai');
                          }}
                          className="px-2 py-1 text-zinc-400 hover:text-cyan-400 transition-colors cursor-pointer"
                          title="AI Analysis"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => {
                            setActiveDocumentId(d.id);
                            setActiveView('audit');
                          }}
                          className="px-2 py-1 text-zinc-400 hover:text-emerald-400 transition-colors cursor-pointer"
                          title="Audit Trail"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>

                        {d.status === 'pending' && (
                          <button
                            onClick={() => openDedicatedSigning(d.id)}
                            className="ml-1 px-2.5 py-1 bg-white text-zinc-950 font-semibold text-[11px] rounded hover:bg-zinc-200 transition-colors cursor-pointer shadow-sm"
                          >
                            Sign Now
                          </button>
                        )}

                        <button
                          onClick={() => {
                            if (window.confirm(`Delete "${d.title}"? This cannot be undone.`)) {
                              deleteDocument(d.id);
                            }
                          }}
                          className="px-2 py-1 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Delete Document"
                          aria-label={`Delete ${d.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredDocs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 px-4 text-center">
                      <p className="text-xs text-zinc-400">
                        {documents.length === 0 ? 'No documents yet.' : `No ${filter} documents.`}
                      </p>
                      {documents.length === 0 && (
                        <button
                          onClick={() => setActiveView('send')}
                          className="mt-3 px-3 py-1.5 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-[11px] rounded cursor-pointer"
                        >
                          Add Your First Document
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
