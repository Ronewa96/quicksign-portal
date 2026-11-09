import React, { useEffect, useState } from 'react';
import { downloadBlob, safeFileName } from '../../lib/textPdf';
import { Send, CheckCircle2, Clock, Download, PenTool, BellRing, Trash2, RefreshCw, XCircle } from 'lucide-react';

interface SentRequest {
  id: string;
  title: string;
  sentAt?: string;
  status: 'pending' | 'completed' | 'declined';
  transactionId?: string;
  hasSignedPdf: boolean;
  mySignToken?: string;
  signingOrder?: 'parallel' | 'sequential';
  /** In a sequential request: whose turn it is */
  currentSignerId?: string;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    status: 'pending' | 'signed' | 'declined';
    signedAt?: string;
    declinedAt?: string;
    declineReason?: string;
  }>;
}

/** Documents this user has sent to other people, with each signer's progress. */
export const SentRequests: React.FC = () => {
  const [requests, setRequests] = useState<SentRequest[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () =>
    fetch('/api/requests')
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data) => setRequests(data.requests || []))
      .catch(() => setRequests([]));

  useEffect(() => {
    load();
  }, []);

  const remind = async (requestId: string, signerId: string, name: string) => {
    setBusyId(signerId);
    try {
      const res = await fetch(`/api/requests/${requestId}/remind/${signerId}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setNotice(res.ok ? `Reminder sent to ${name}.` : data.error || 'Could not send the reminder.');
    } finally {
      setBusyId(null);
    }
  };

  const downloadSigned = async (request: SentRequest) => {
    const res = await fetch(`/api/requests/${request.id}/signed.pdf`);
    if (res.ok) downloadBlob(await res.blob(), `${safeFileName(request.title)}_signed.pdf`);
  };

  const remove = async (request: SentRequest) => {
    if (!window.confirm(`Delete "${request.title}"? Signing links for it will stop working.`)) return;
    await fetch(`/api/requests/${request.id}`, { method: 'DELETE' });
    load();
  };

  if (!requests || requests.length === 0) return null;

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-display">Sent for Signing</h3>
        </div>
        <button onClick={load} className="p-1 text-zinc-500 hover:text-white cursor-pointer" title="Refresh" aria-label="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {notice && (
        <div className="px-4 py-2 text-xs text-emerald-300 bg-emerald-950/20 border-b border-zinc-800 flex justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="cursor-pointer" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="divide-y divide-zinc-800/80">
        {requests.map((r) => {
          const signed = r.signers.filter((s) => s.status === 'signed').length;
          const decliner = r.signers.find((s) => s.status === 'declined');
          return (
            <div key={r.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{r.title}</div>
                  <div className="text-[11px] text-zinc-500">
                    Sent {r.sentAt ? new Date(r.sentAt).toLocaleString() : ''} · {signed} of {r.signers.length} signed
                    {r.signingOrder === 'sequential' ? ' · in order' : ''}
                    {r.transactionId ? ` · ${r.transactionId}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded ${
                      r.status === 'completed'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : r.status === 'declined'
                        ? 'bg-rose-500/15 text-rose-300'
                        : 'bg-cyan-500/10 text-cyan-300'
                    }`}
                  >
                    {r.status === 'completed' ? 'Completed' : r.status === 'declined' ? 'Declined' : 'Waiting'}
                  </span>
                  {r.mySignToken && (
                    <a
                      href={`/sign/${r.mySignToken}`}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white text-zinc-950 font-semibold text-[11px] rounded hover:bg-zinc-200"
                    >
                      <PenTool className="w-3 h-3" />
                      <span>Sign my part</span>
                    </a>
                  )}
                  {r.hasSignedPdf && (
                    <button
                      onClick={() => downloadSigned(r)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] rounded cursor-pointer hover:text-white"
                    >
                      <Download className="w-3 h-3" />
                      <span>Signed PDF</span>
                    </button>
                  )}
                  <button
                    onClick={() => remove(r)}
                    className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                    title="Delete"
                    aria-label={`Delete ${r.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {r.signers.map((s, index) => {
                  const sequential = r.signingOrder === 'sequential';
                  // In order: later signers haven't been emailed yet, so they can't be reminded
                  const waitingTurn = sequential && r.status === 'pending' && s.status === 'pending' && s.id !== r.currentSignerId;
                  return (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-zinc-900/60 border border-zinc-800 text-xs"
                  >
                    {sequential && <span className="font-mono text-[10px] text-zinc-500">{index + 1}.</span>}
                    {s.status === 'signed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : s.status === 'declined' ? (
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Clock className={`w-3.5 h-3.5 ${waitingTurn ? 'text-zinc-600' : 'text-amber-400'}`} />
                    )}
                    <span className={waitingTurn ? 'text-zinc-500' : 'text-zinc-200'}>{s.name}</span>
                    <span className="text-zinc-500 hidden sm:inline">{s.email}</span>
                    {sequential && s.id === r.currentSignerId && (
                      <span className="text-[10px] uppercase font-semibold text-amber-300">Their turn</span>
                    )}
                    {waitingTurn && <span className="text-[10px] text-zinc-600">Not yet sent</span>}
                    {s.status === 'declined' && <span className="text-[10px] uppercase font-semibold text-rose-300">Declined</span>}
                    {s.status === 'pending' && !waitingTurn && r.status === 'pending' && (
                      <button
                        onClick={() => remind(r.id, s.id, s.name)}
                        disabled={busyId === s.id}
                        className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 cursor-pointer disabled:opacity-50"
                        title="Email a reminder"
                      >
                        <BellRing className="w-3 h-3" />
                        <span>Remind</span>
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>

              {decliner && (
                <div className="flex items-start gap-2 p-2.5 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-200">
                  <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-400" />
                  <div className="min-w-0">
                    <div>
                      {decliner.name} declined to sign
                      {decliner.declinedAt ? ` on ${new Date(decliner.declinedAt).toLocaleString()}` : ''}.
                    </div>
                    <div className="text-rose-300/80 whitespace-pre-wrap wrap-break-word mt-0.5">
                      {decliner.declineReason ? `Reason: ${decliner.declineReason}` : 'No reason given.'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
