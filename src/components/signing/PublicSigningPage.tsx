import React, { useEffect, useRef, useState } from 'react';
import { PdfPage } from '../viewer/PdfPage';
import { SignatureModal } from './SignatureModal';
import { buildSignedPdf } from '../../lib/signedPdf';
import { downloadBlob, safeFileName } from '../../lib/textPdf';
import { useElementWidth, fitScale } from '../../lib/useElementWidth';
import { ThemeToggle } from '../common/ThemeToggle';
import { QuickDocument, SignatureTag } from '../../types';
import {
  ArrowLeft,
  PenTool,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Download,
  ShieldCheck,
  Minus,
  Plus,
  Users,
  XCircle,
} from 'lucide-react';

type SignerStatus = 'pending' | 'signed' | 'declined';

interface SignView {
  id: string;
  title: string;
  pages: string[];
  rawText: string;
  hasOriginal: boolean;
  status: 'pending' | 'completed' | 'declined';
  transactionId?: string;
  completedAt?: string;
  declinedAt?: string;
  hasSignedPdf: boolean;
  sender: { name: string; email: string };
  me: { id: string; name: string; email: string; role: string; status: SignerStatus };
  signers: Array<{ name: string; email: string; role: string; status: SignerStatus; signedAt?: string; declineReason?: string }>;
  tags: SignatureTag[];
  signingOrder?: 'parallel' | 'sequential';
  /** False when someone earlier in the signing order still has to sign */
  myTurn?: boolean;
  waitingFor?: string;
  /** Summary the sender chose to share */
  aiSummary?: { source: 'gemini' | 'fallback'; summary: string; keyPoints: string[]; disclaimer: string };
}

interface PlacedTag {
  id: string;
  type: 'signature' | 'date';
  pageIndex: number;
  x: number;
  y: number;
  scale: number;
}

const PAGE_WIDTH = 820;
const SIGNATURE_HEIGHT = 40;
const RETURN_SECONDS = 5;

/** Builds the signed PDF for a completed request and uploads it so everyone gets it by email. */
async function finalizeSignedCopy(token: string, view: SignView, original: Blob | null) {
  const doc: QuickDocument = {
    id: view.id,
    title: view.title,
    category: '',
    fileType: 'pdf',
    pages: view.pages,
    rawText: view.rawText,
    originalFile: view.hasOriginal ? { name: 'original.pdf', mimeType: 'application/pdf', size: original?.size || 0 } : undefined,
    status: 'completed',
    createdAt: '',
    updatedAt: '',
    createdBy: view.sender.name,
    signers: [],
    signatureTags: view.tags,
    auditTrail: [],
    transactionId: view.transactionId,
    signedAt: view.completedAt,
  };
  const pdf = await buildSignedPdf(doc, original || undefined);
  const res = await fetch(`/api/sign/${token}/final`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  if (!res.ok) throw new Error('The signed copy could not be saved.');
}

export const PublicSigningPage: React.FC<{ token: string }> = ({ token }) => {
  const [view, setView] = useState<SignView | null>(null);
  const [original, setOriginal] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [armed, setArmed] = useState<'signature' | 'date' | null>(null);
  const [placed, setPlaced] = useState<PlacedTag[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isDeclineOpen, setIsDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [isDeclining, setIsDeclining] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [viewportRef, viewportWidth] = useElementWidth();
  const scale = fitScale(viewportWidth, PAGE_WIDTH);

  // Make sure a completed request has its signed copy (e.g. if the last signer closed the page early)
  const ensureSignedCopy = async (data: SignView, originalPdf: Blob | null) => {
    if (data.status !== 'completed' || data.hasSignedPdf) return data;
    setIsFinalizing(true);
    try {
      await finalizeSignedCopy(token, data, originalPdf);
      return { ...data, hasSignedPdf: true };
    } catch (err: any) {
      setError(err?.message || 'The signed copy could not be created.');
      return data;
    } finally {
      setIsFinalizing(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sign/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This signing link is not valid.');
        let pdf: Blob | null = null;
        if (data.hasOriginal) {
          const fileRes = await fetch(`/api/sign/${token}/original`);
          if (fileRes.ok) pdf = await fileRes.blob();
        }
        setOriginal(pdf);
        setView(await ensureSignedCopy(data, pdf));
      } catch (err: any) {
        setError(err?.message || 'Could not open this document.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const placeAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!armed || !pageRef.current || (e.target as HTMLElement).closest('[data-tag]')) return;
    const rect = pageRef.current.getBoundingClientRect();
    const x = Math.max(5, Math.min(90, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(3, Math.min(95, ((e.clientY - rect.top) / rect.height) * 100));
    setPlaced((prev) => [...prev, { id: `p-${Date.now()}`, type: armed, pageIndex, x, y, scale: 1 }]);
    setArmed(null);
  };

  const armSignature = () => {
    if (!signatureUrl) {
      setIsModalOpen(true);
      return;
    }
    setArmed((a) => (a === 'signature' ? null : 'signature'));
  };

  // After signing or declining: people signed in to QuickSign go back to their dashboard automatically
  const [signedIn, setSignedIn] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [returnIn, setReturnIn] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => setSignedIn(res.ok))
      .catch(() => setSignedIn(false));
  }, []);

  useEffect(() => {
    if (justFinished && signedIn && !isFinalizing && !error) setReturnIn(RETURN_SECONDS);
  }, [justFinished, signedIn, isFinalizing, error]);

  useEffect(() => {
    if (returnIn === null) return;
    if (returnIn <= 0) {
      window.location.assign('/');
      return;
    }
    const timer = setTimeout(() => setReturnIn(returnIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [returnIn]);

  const handleFinish = async () => {
    if (!view || !signatureUrl || !placed.some((t) => t.type === 'signature')) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: placed.map((t) => ({
            type: t.type,
            pageIndex: t.pageIndex,
            x: t.x,
            y: t.y,
            scale: t.scale,
            signatureDataUrl: t.type === 'signature' ? signatureUrl : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signing failed.');
      setPlaced([]);
      setView(await ensureSignedCopy(data, original));
      setJustFinished(true);
    } catch (err: any) {
      setError(err?.message || 'Signing failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setIsDeclining(true);
    setError(null);
    try {
      const res = await fetch(`/api/sign/${token}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not decline the document.');
      setIsDeclineOpen(false);
      setView(data);
      setJustFinished(true);
    } catch (err: any) {
      setError(err?.message || 'Could not decline the document. Please try again.');
      setIsDeclineOpen(false);
    } finally {
      setIsDeclining(false);
    }
  };

  const downloadSigned = async () => {
    const res = await fetch(`/api/sign/${token}/signed.pdf`);
    if (res.ok) downloadBlob(await res.blob(), `${safeFileName(view?.title || 'document')}_signed.pdf`);
  };

  // ---------- Screens ----------

  const shell = (content: React.ReactNode) => (
    <div className="relative min-h-dvh w-full bg-zinc-950 text-zinc-100 font-sans antialiased flex items-center justify-center p-4">
      <ThemeToggle className="absolute top-3 right-3" />
      <div className="w-full max-w-md text-center space-y-4">{content}</div>
    </div>
  );

  const backToApp = (
    <div className="pt-2 space-y-2">
      {returnIn !== null && (
        <p role="status" className="text-xs text-zinc-400">
          Returning to your dashboard in {returnIn}…
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-700 text-zinc-200 hover:text-white font-semibold text-sm rounded"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{signedIn ? 'Back to dashboard' : 'Go to QuickSign'}</span>
        </a>
        {returnIn !== null && (
          <button
            onClick={() => {
              setReturnIn(null);
              setJustFinished(false);
            }}
            className="text-xs text-zinc-400 hover:text-white underline cursor-pointer"
          >
            Stay on this page
          </button>
        )}
      </div>
    </div>
  );

  if (loading) {
    return shell(<RefreshCw className="w-6 h-6 animate-spin text-cyan-400 mx-auto" />);
  }

  if (!view) {
    return shell(
      <>
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
        <h1 className="text-lg font-bold text-white font-display">Link not available</h1>
        <p className="text-sm text-zinc-400">{error}</p>
        {backToApp}
      </>
    );
  }

  if (view.me.status === 'signed' && view.status !== 'declined') {
    const remaining = view.signers.filter((s) => s.status === 'pending');
    return shell(
      <>
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-400 mx-auto flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h1 className="text-lg font-bold text-white font-display">You have signed "{view.title}"</h1>
        {view.status === 'completed' ? (
          <p className="text-sm text-zinc-400">
            Everyone has signed. A copy of the fully signed document has been emailed to you
            {view.transactionId ? ` (transaction ID ${view.transactionId})` : ''}.
          </p>
        ) : (
          <p className="text-sm text-zinc-400">
            Still waiting for {remaining.map((s) => s.name).join(', ')}. You will get the fully signed document by email
            when everyone has signed.
          </p>
        )}
        {isFinalizing && (
          <p className="text-xs text-zinc-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Preparing the signed copy…
          </p>
        )}
        {view.hasSignedPdf && (
          <button
            onClick={downloadSigned}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-sm rounded cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download signed copy</span>
          </button>
        )}
        {error && <p className="text-xs text-rose-400">{error}</p>}
        {backToApp}
      </>
    );
  }

  if (view.status === 'declined') {
    const decliner = view.signers.find((s) => s.status === 'declined');
    const iDeclined = view.me.status === 'declined';
    return shell(
      <>
        <div className="w-14 h-14 rounded-full bg-rose-500/15 text-rose-400 mx-auto flex items-center justify-center">
          <XCircle className="w-8 h-8" />
        </div>
        <h1 className="text-lg font-bold text-white font-display">
          {iDeclined ? `You declined to sign "${view.title}"` : `"${view.title}" was declined`}
        </h1>
        <p className="text-sm text-zinc-400">
          {iDeclined
            ? `${view.sender.name} has been told by email. Nothing else is needed from you.`
            : `${decliner?.name || 'One of the signers'} declined to sign, so this document can no longer be signed. Contact ${view.sender.name} (${view.sender.email}) if you have questions.`}
        </p>
        {decliner?.declineReason && (
          <blockquote className="text-sm text-zinc-300 text-left border-l-2 border-rose-500/50 pl-3 py-1 whitespace-pre-wrap wrap-break-word">
            {decliner.declineReason}
          </blockquote>
        )}
        {backToApp}
      </>
    );
  }

  if (view.myTurn === false) {
    return shell(
      <>
        <Users className="w-8 h-8 text-amber-400 mx-auto" />
        <h1 className="text-lg font-bold text-white font-display">It isn't your turn yet</h1>
        <p className="text-sm text-zinc-400">
          "{view.title}" is signed in order. {view.waitingFor || 'Someone else'} needs to sign before you. We'll email
          you when it's your turn.
        </p>
        <ol className="text-xs text-zinc-400 text-left inline-block space-y-1">
          {view.signers.map((s, i) => (
            <li key={s.email}>
              {i + 1}. {s.name}
              {s.status === 'signed' ? ' ✓' : s.email === view.me.email ? ' (you)' : ''}
            </li>
          ))}
        </ol>
        {backToApp}
      </>
    );
  }

  const othersTags = view.tags.filter((t) => t.pageIndex === pageIndex && t.isCompleted);
  const myTags = placed.filter((t) => t.pageIndex === pageIndex);
  const hasSignature = placed.some((t) => t.type === 'signature');

  const overlays = (
    <>
      {othersTags.map((t) => (
        <div
          key={t.id}
          data-tag
          style={{ position: 'absolute', left: `${t.x}%`, top: `${t.y}%` }}
          className="-translate-x-1/2 -translate-y-1/2 p-1.5 rounded border border-emerald-500/50 bg-emerald-500/5 text-center"
        >
          {t.type === 'signature' && t.signatureDataUrl ? (
            <img src={t.signatureDataUrl} alt={`Signed by ${t.signerName}`} style={{ height: SIGNATURE_HEIGHT * (t.scale ?? 1) }} className="w-auto max-w-none" />
          ) : (
            <span className="text-[11px] font-mono text-zinc-800">{new Date(t.completedAt || Date.now()).toLocaleDateString('en-CA')}</span>
          )}
          <div className="text-[9px] font-mono text-emerald-600">Signed by {t.signerName}</div>
        </div>
      ))}
      {myTags.map((t) => (
        <div
          key={t.id}
          data-tag
          style={{ position: 'absolute', left: `${t.x}%`, top: `${t.y}%` }}
          className="-translate-x-1/2 -translate-y-1/2 p-1.5 rounded border-2 border-cyan-500 bg-cyan-50/80"
        >
          {t.type === 'signature' && signatureUrl ? (
            <img src={signatureUrl} alt="Your signature" style={{ height: SIGNATURE_HEIGHT * t.scale }} className="w-auto max-w-none" />
          ) : (
            <span className="text-[11px] font-mono text-zinc-800 px-1">{new Date().toLocaleDateString('en-CA')}</span>
          )}
          <div className="absolute -top-3 right-1 flex gap-1">
            {t.type === 'signature' && (
              <>
                <button
                  onClick={() => setPlaced((p) => p.map((x) => (x.id === t.id ? { ...x, scale: Math.max(0.5, x.scale - 0.25) } : x)))}
                  className="w-5 h-5 rounded-full bg-zinc-800 text-white flex items-center justify-center cursor-pointer"
                  aria-label="Make smaller"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setPlaced((p) => p.map((x) => (x.id === t.id ? { ...x, scale: Math.min(5, x.scale + 0.25) } : x)))}
                  className="w-5 h-5 rounded-full bg-zinc-800 text-white flex items-center justify-center cursor-pointer"
                  aria-label="Make bigger"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </>
            )}
            <button
              onClick={() => setPlaced((p) => p.filter((x) => x.id !== t.id))}
              className="w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center cursor-pointer"
              aria-label="Remove"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div className="h-dvh w-full flex flex-col bg-zinc-950 text-zinc-100 font-sans antialiased overflow-hidden">
      {/* Header */}
      <header className="px-3 sm:px-6 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-white text-zinc-950 font-bold text-sm flex items-center justify-center font-display shrink-0">QS</div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{view.title}</div>
            <div className="text-[11px] text-zinc-400 truncate">
              From {view.sender.name} · signing as {view.me.name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setIsDeclineOpen(true)}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-700 hover:border-rose-500/60 hover:text-rose-300 text-zinc-300 text-xs rounded cursor-pointer disabled:opacity-40"
          >
            <XCircle className="w-4 h-4" />
            <span>Decline</span>
          </button>
          <button
            onClick={handleFinish}
            disabled={!hasSignature || isSubmitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>{isSubmitting ? 'Signing…' : 'Finish'}</span>
          </button>
        </div>
      </header>

      {/* Tools */}
      <div className="px-3 sm:px-6 py-2.5 border-b border-zinc-800 flex flex-wrap items-center gap-2 shrink-0">
        <button
          onClick={armSignature}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border cursor-pointer ${
            armed === 'signature' ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300' : 'border-zinc-700 bg-zinc-900 text-zinc-200'
          }`}
        >
          <PenTool className="w-3.5 h-3.5 text-cyan-400" />
          <span>Add signature</span>
        </button>
        <button
          onClick={() => setArmed((a) => (a === 'date' ? null : 'date'))}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border cursor-pointer ${
            armed === 'date' ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300' : 'border-zinc-700 bg-zinc-900 text-zinc-200'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-cyan-400" />
          <span>Add date</span>
        </button>
        {signatureUrl && (
          <button onClick={() => setIsModalOpen(true)} className="text-xs text-zinc-400 hover:text-white underline cursor-pointer">
            Change signature
          </button>
        )}

        <div className="ml-auto flex items-center gap-1 text-xs font-mono text-zinc-400">
          <button
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={pageIndex === 0}
            className="p-1 disabled:opacity-30 cursor-pointer"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="whitespace-nowrap">
            {pageIndex + 1} / {view.pages.length}
          </span>
          <button
            onClick={() => setPageIndex((p) => Math.min(view.pages.length - 1, p + 1))}
            disabled={pageIndex >= view.pages.length - 1}
            className="p-1 disabled:opacity-30 cursor-pointer"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-3 sm:px-6 py-2 text-[11px] text-zinc-400 border-b border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-1 shrink-0">
        <span className={armed ? 'text-cyan-300 font-medium' : ''}>
          {armed
            ? 'Tap the page where it should go.'
            : hasSignature
            ? 'Done placing? Click Finish to sign.'
            : 'Click "Add signature", then tap the page where you want to sign.'}
        </span>
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {view.signers.map((s) => `${s.name}${s.status === 'signed' ? ' ✓' : ''}`).join(' · ')}
        </span>
      </div>

      {view.aiSummary && (
        <details className="px-3 sm:px-6 py-2 border-b border-zinc-800 text-xs shrink-0">
          <summary className="cursor-pointer font-medium text-cyan-300">
            {view.aiSummary.source === 'gemini' ? 'AI summary of this document' : 'Quick summary of this document'}
          </summary>
          <div className="mt-2 max-h-48 overflow-y-auto space-y-2 text-zinc-300">
            <p className="whitespace-pre-wrap leading-relaxed">{view.aiSummary.summary}</p>
            {view.aiSummary.keyPoints.length > 0 && (
              <ul className="list-disc pl-4 space-y-1 text-zinc-400">
                {view.aiSummary.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-zinc-500">{view.aiSummary.disclaimer} Read the document itself before you sign.</p>
          </div>
        </details>
      )}

      {error && (
        <div role="alert" className="mx-3 sm:mx-6 mt-3 flex items-start gap-2 p-3 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Document */}
      <div ref={viewportRef} className="flex-1 min-h-0 overflow-auto p-3 sm:p-8 flex justify-center-safe items-start">
        {view.hasOriginal && original ? (
          <div style={{ zoom: scale }} className={`h-fit shrink-0 mb-10 ${armed ? 'cursor-crosshair' : ''}`}>
            <PdfPage file={original} pageIndex={pageIndex} width={PAGE_WIDTH} displayScale={scale} containerRef={pageRef} onClick={placeAt}>
              {overlays}
            </PdfPage>
          </div>
        ) : (
          <div
            ref={pageRef}
            onClick={placeAt}
            style={{ zoom: scale }}
            className={`paper relative shrink-0 w-205 min-h-270 bg-white text-zinc-900 shadow-2xl p-14 mb-10 ${armed ? 'cursor-crosshair' : ''}`}
          >
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-800">{view.pages[pageIndex]}</div>
            {overlays}
          </div>
        )}
      </div>

      <footer className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-500 flex items-center justify-center gap-1.5 shrink-0">
        <ShieldCheck className="w-3 h-3" />
        <span>Signing with QuickSign. Your signature, the time, and your IP address are recorded in the document's audit trail.</span>
      </footer>

      <SignatureModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialSignerName={view.me.name}
        onSave={(url) => {
          setSignatureUrl(url);
          setArmed('signature');
        }}
      />

      {isDeclineOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="decline-title">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg p-5 space-y-4">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 id="decline-title" className="text-sm font-bold text-white font-display">
                  Decline to sign "{view.title}"?
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  The document will be stopped and nobody else will be able to sign it. {view.sender.name} will be told by email.
                </p>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-300">
                Reason <span className="text-zinc-500">(optional)</span>
              </span>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                maxLength={1000}
                rows={4}
                autoFocus
                placeholder="For example: the payment terms in section 3 are wrong."
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-rose-500/60 resize-none"
              />
              <span className="block text-right text-[10px] text-zinc-600">{declineReason.length} / 1000</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsDeclineOpen(false)}
                disabled={isDeclining}
                className="px-3 py-2 text-xs text-zinc-300 hover:text-white cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleDecline}
                disabled={isDeclining}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded cursor-pointer disabled:opacity-50"
              >
                {isDeclining && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isDeclining ? 'Declining…' : 'Decline document'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
