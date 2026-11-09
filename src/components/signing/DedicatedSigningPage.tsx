import React, { useState, useRef, useEffect } from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { SignatureModal } from './SignatureModal';
import { PdfPage } from '../viewer/PdfPage';
import { buildSignedPdf } from '../../lib/signedPdf';
import { downloadBlob, safeFileName } from '../../lib/textPdf';
import { typedSignatureSvg } from '../../lib/signatureSvg';
import { useElementWidth, fitScale } from '../../lib/useElementWidth';
import { SignatureTag, TagType } from '../../types';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  PenTool,
  Calendar,
  User,
  ShieldCheck,
  Eye,
  Trash2,
  Sparkles,
  Move,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

// Signature images are 40px tall at 100% on the 820px page, and can be resized between 50% and 500%
const SIGNATURE_BASE_HEIGHT = 40;
const MIN_SIGNATURE_SCALE = 0.5;
const MAX_SIGNATURE_SCALE = 5;

export const DedicatedSigningPage: React.FC = () => {
  const {
    documents,
    activeDocumentId,
    signingTargetDocId,
    setActiveView,
    signDocument,
    userProfile,
    addSignatureTag,
    updateSignatureTag,
    removeSignatureTag,
    saveSignatureToProfile,
  } = useDocuments();

  // Find target document to sign
  const targetDocId = signingTargetDocId || activeDocumentId;
  const doc = documents.find((d) => d.id === targetDocId) || documents[0];

  const [activePageIndex, setActivePageIndex] = useState(0);
  const [zoomScale, setZoomScale] = useState(1.0);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [currentSignatureUrl, setCurrentSignatureUrl] = useState<string | null>(
    userProfile.savedSignatureUrl || null
  );

  // Dragging states
  const [draggedTagType, setDraggedTagType] = useState<TagType | 'existingSignature' | null>(null);
  const [isSigningLoading, setIsSigningLoading] = useState(false);

  // Success state after signing
  const [signedResult, setSignedResult] = useState<{
    success: boolean;
    transactionId: string;
    sha256Hash: string;
  } | null>(null);

  const documentPageRef = useRef<HTMLDivElement | null>(null);

  // Touch screens can't drag and drop: tap a tool to select it, then tap the page to place it
  const [armedTool, setArmedTool] = useState<TagType | 'existingSignature' | null>(null);

  // The 820px page is scaled to fit the available width (phones, tablets), then by the zoom level
  const [viewportRef, viewportWidth] = useElementWidth();

  // Live size while a signature's resize handle is being dragged (committed on release)
  const [resizing, setResizing] = useState<{ tagId: string; scale: number } | null>(null);
  const resizingRef = useRef<{ tagId: string; scale: number } | null>(null);

  // Ensure user has a default signature initialized if none exists
  useEffect(() => {
    if (!currentSignatureUrl && userProfile.name) {
      // Auto-generate a typed vector signature so signing works right away
      const autoSig = typedSignatureSvg(userProfile.name, {
        family: 'Georgia, serif',
        size: 28,
        style: 'italic',
        weight: 700,
      });
      setCurrentSignatureUrl(autoSig);
      saveSignatureToProfile(autoSig);
    }
  }, [userProfile.name]);

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-zinc-400">
        <p>No document selected for signing.</p>
      </div>
    );
  }

  const pageScale = fitScale(viewportWidth, 820, zoomScale);

  // Places a tool on the current page at a screen position (from a drop or a tap)
  const placeTag = (kind: TagType | 'existingSignature', clientX: number, clientY: number) => {
    if (!documentPageRef.current) return;
    const pageIdx = activePageIndex;

    const rect = documentPageRef.current.getBoundingClientRect();
    const x = Math.max(5, Math.min(85, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(5, Math.min(90, ((clientY - rect.top) / rect.height) * 100));

    if (kind === 'existingSignature') {
      // Direct signature placement
      addSignatureTag(doc.id, {
        pageIndex: pageIdx,
        x,
        y,
        type: 'signature',
        signerName: userProfile.name,
        signerEmail: userProfile.email,
        isCompleted: true,
        signatureDataUrl: currentSignatureUrl || undefined,
        completedAt: new Date().toISOString(),
      });
    } else {
      addSignatureTag(doc.id, {
        pageIndex: pageIdx,
        x,
        y,
        type: kind,
        signerName: userProfile.name,
        signerEmail: userProfile.email,
        isCompleted: false,
      });
    }
  };

  const handlePageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggedTagType) placeTag(draggedTagType, e.clientX, e.clientY);
    setDraggedTagType(null);
  };

  // Tap-to-place: ignore taps on existing tags (their own buttons handle those)
  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!armedTool || (e.target as HTMLElement).closest('[data-tag]')) return;
    placeTag(armedTool, e.clientX, e.clientY);
    setArmedTool(null);
  };

  const toggleArmedTool = (kind: TagType | 'existingSignature') =>
    setArmedTool((current) => (current === kind ? null : kind));

  const handlePageDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // Sign a specific signature box with one click
  const handleCompleteTag = (tag: SignatureTag) => {
    if (!currentSignatureUrl) {
      setIsSignatureModalOpen(true);
      return;
    }

    updateSignatureTag(doc.id, tag.id, {
      isCompleted: true,
      signatureDataUrl: currentSignatureUrl,
      completedAt: new Date().toISOString(),
    });
  };

  // Finish signing and record the signature
  const handleFinalSeal = async () => {
    setIsSigningLoading(true);
    try {
      const sigToUse = currentSignatureUrl || 'data:image/svg+xml;utf8,<svg .../>';
      const result = await signDocument(doc.id, sigToUse, userProfile.name);

      setSignedResult(result);

      // Celebration confetti
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00f0ff', '#ffffff', '#38bdf8', '#0ea5e9'],
        });
      } catch (e) {}
    } catch (err) {
      console.error('Sealing failed:', err);
    } finally {
      setIsSigningLoading(false);
    }
  };

  // Download the signed document as a PDF with signatures stamped in place
  const handleDownloadSigned = async () => {
    const txId = signedResult?.transactionId || doc.transactionId || 'DOCUMENT';
    try {
      downloadBlob(await buildSignedPdf(doc), `${safeFileName(doc.title)}_SIGNED_${txId}.pdf`);
    } catch (err: any) {
      window.alert(err?.message || 'Could not generate the signed PDF.');
    }
  };

  // Filter tags for current active page
  const currentPageTags = doc.signatureTags.filter((t) => t.pageIndex === activePageIndex);
  const pendingTagsCount = doc.signatureTags.filter((t) => !t.isCompleted).length;

  const tagScale = (tag: SignatureTag) =>
    resizing?.tagId === tag.id ? resizing.scale : tag.scale ?? 1;

  // Drag the corner handle to resize a placed signature; the image is vector, so it stays sharp
  const startResize = (e: React.PointerEvent<HTMLSpanElement>, tag: SignatureTag) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startScale = tag.scale ?? 1;

    const onMove = (ev: PointerEvent) => {
      // Tags are centred on their point, so the corner moves half as far as the size grows
      const delta = (ev.clientX - startX + (ev.clientY - startY)) / 2 / pageScale;
      const scale = Math.min(MAX_SIGNATURE_SCALE, Math.max(MIN_SIGNATURE_SCALE, startScale + (delta * 2) / SIGNATURE_BASE_HEIGHT));
      resizingRef.current = { tagId: tag.id, scale };
      setResizing(resizingRef.current);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (resizingRef.current) {
        updateSignatureTag(doc.id, tag.id, { scale: Math.round(resizingRef.current.scale * 100) / 100 });
      }
      resizingRef.current = null;
      setResizing(null);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  // Signature tags placed on the current page (shared by PDF and text page views)
  const tagElements = currentPageTags.map((tag) => {
    return (
      <div
        key={tag.id}
        style={{
          position: 'absolute',
          left: `${tag.x}%`,
          top: `${tag.y}%`,
        }}
        data-tag
        className={`group -translate-x-1/2 -translate-y-1/2 p-2 rounded border transition-colors ${
          tag.isCompleted
            ? 'border-emerald-500 bg-emerald-500/10'
            : 'border-cyan-500 bg-cyan-950/80 text-cyan-300 shadow-lg shadow-cyan-500/30'
        }`}
      >
        {tag.type === 'signature' && (
          <div className="flex flex-col items-center">
            {tag.isCompleted && tag.signatureDataUrl ? (
              <div className="flex flex-col items-center">
                <img
                  src={tag.signatureDataUrl}
                  alt="Signed"
                  draggable={false}
                  style={{ height: SIGNATURE_BASE_HEIGHT * tagScale(tag) }}
                  className="w-auto max-w-none object-contain drop-shadow"
                />
                <div className="text-[9px] font-mono text-emerald-600 mt-1 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Signed: {tag.signerName}</span>
                  {resizing?.tagId === tag.id && (
                    <span className="text-zinc-500">· {Math.round(tagScale(tag) * 100)}%</span>
                  )}
                </div>

                {/* Resize handle */}
                <span
                  onPointerDown={(e) => startResize(e, tag)}
                  title="Drag to resize"
                  aria-label="Resize signature"
                  className="absolute -bottom-2 -right-2 w-4 h-4 rounded-sm bg-emerald-500 border-2 border-white shadow cursor-nwse-resize touch-none opacity-70 group-hover:opacity-100"
                />
              </div>
            ) : (
              <button
                onClick={() => handleCompleteTag(tag)}
                className="flex items-center gap-1.5 px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs rounded shadow cursor-pointer transition-transform hover:scale-105"
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>Sign Here ({tag.signerName})</span>
              </button>
            )}
          </div>
        )}

        {tag.type === 'date' && (
          <div className="text-[11px] font-mono px-2 py-0.5 bg-zinc-100 text-zinc-800 rounded border border-zinc-300 flex items-center gap-1">
            <Calendar className="w-3 h-3 text-cyan-600" />
            <span>{new Date(tag.completedAt || Date.now()).toLocaleDateString('en-CA')}</span>
          </div>
        )}

        {tag.type === 'nameTag' && (
          <div className="text-[11px] font-sans font-semibold px-2 py-0.5 bg-zinc-100 text-zinc-800 rounded border border-zinc-300">
            Signer: {tag.signerName}
          </div>
        )}

        {/* Remove tag control */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeSignatureTag(doc.id, tag.id);
          }}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] shadow cursor-pointer"
          title="Remove tag"
        >
          ×
        </button>
      </div>
    );
  });

  return (
    <div className="h-dvh w-full flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      {/* Top bar */}
      <div className="min-h-14 py-2 border-b border-zinc-800 bg-zinc-950/80 px-3 sm:px-6 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={() => setActiveView('dashboard')}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="hidden sm:block h-4 w-px bg-zinc-800"></div>

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-white tracking-tight font-display truncate max-w-[40vw] sm:max-w-sm">
              {doc.title}
            </span>
            {/* Page navigation here on phones/tablets, where the page list is hidden */}
            <div className="flex items-center gap-0.5 text-[11px] font-mono text-cyan-400/80 shrink-0">
              <button
                onClick={() => setActivePageIndex((p) => Math.max(0, p - 1))}
                disabled={activePageIndex === 0}
                className="lg:hidden p-1 disabled:opacity-30 cursor-pointer"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span>
                <span className="hidden sm:inline">Page </span>
                {activePageIndex + 1} / {doc.pages.length}
              </span>
              <button
                onClick={() => setActivePageIndex((p) => Math.min(doc.pages.length - 1, p + 1))}
                disabled={activePageIndex >= doc.pages.length - 1}
                className="lg:hidden p-1 disabled:opacity-30 cursor-pointer"
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Action Controls & Finish Button */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-400">
            <button
              onClick={() => setZoomScale((prev) => Math.max(0.7, prev - 0.1))}
              className="p-1 hover:text-white transition-colors cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] px-1">{Math.round(zoomScale * 100)}%</span>
            <button
              onClick={() => setZoomScale((prev) => Math.min(1.5, prev + 0.1))}
              className="p-1 hover:text-white transition-colors cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setIsSignatureModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 transition-colors cursor-pointer"
          >
            <PenTool className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Manage Signature</span>
            <span className="sm:hidden">Signature</span>
          </button>

          <button
            onClick={handleFinalSeal}
            disabled={isSigningLoading}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs rounded transition-all shadow-lg shadow-cyan-500/20 active:scale-[0.98] cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSigningLoading ? 'Finishing...' : 'Finish Signing'}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Layout: tools above the page on phones/tablets, beside it on desktop */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Overview & Tool Panel */}
        <div className="lg:w-72 border-b lg:border-b-0 lg:border-r border-zinc-800/80 bg-zinc-950/60 flex flex-col shrink-0">
          {/* Draggable Toolbox */}
          <div className="p-3 lg:p-4 lg:border-b border-zinc-800/80 space-y-2 lg:space-y-3">
            <div className="hidden lg:block text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Signing Tools
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              {armedTool
                ? 'Now tap the page where it should go.'
                : 'Drag an item onto the page, or tap it and then tap the page. Tap a highlighted box to sign it.'}
            </p>

            <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 lg:gap-3">
            {/* Draggable Signature Item */}
            <div
              draggable
              onDragStart={() => setDraggedTagType('existingSignature')}
              onClick={() => toggleArmedTool('existingSignature')}
              className={`p-2 lg:p-3 bg-zinc-900/90 border rounded cursor-grab active:cursor-grabbing transition-all group shadow-sm ${
                armedTool === 'existingSignature' ? 'border-cyan-400 ring-2 ring-cyan-500/40' : 'border-zinc-700/80 hover:border-cyan-500/80'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-medium text-zinc-300 group-hover:text-cyan-300">
                <span className="flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5 text-cyan-400" />
                  <span>My Signature</span>
                </span>
                <Move className="hidden lg:block w-3 h-3 text-zinc-500 group-hover:text-cyan-400" />
              </div>
              {currentSignatureUrl ? (
                <div className="paper hidden lg:flex mt-2 h-10 items-center justify-center bg-white rounded p-1 border border-zinc-300">
                  <img
                    src={currentSignatureUrl}
                    alt="Active signature"
                    className="max-h-8 object-contain filter drop-shadow"
                  />
                </div>
              ) : (
                <div className="hidden lg:block mt-2 text-[11px] text-zinc-500 italic">Click Manage Signature above</div>
              )}
            </div>

            {/* Signature Tag (Sign Here tag with user name) */}
            <div
              draggable
              onDragStart={() => setDraggedTagType('signature')}
              onClick={() => toggleArmedTool('signature')}
              className={`p-2 lg:p-2.5 bg-zinc-900 border rounded cursor-grab active:cursor-grabbing transition-all flex items-center justify-between group ${
                armedTool === 'signature' ? 'border-cyan-400 ring-2 ring-cyan-500/40' : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-zinc-300 min-w-0">
                <User className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">
                  <span className="lg:hidden">Sign box</span>
                  <span className="hidden lg:inline">Signature box: {userProfile.name}</span>
                </span>
              </div>
              <span className="hidden lg:inline text-[10px] font-mono text-zinc-500">Drag</span>
            </div>

            {/* Date Tag */}
            <div
              draggable
              onDragStart={() => setDraggedTagType('date')}
              onClick={() => toggleArmedTool('date')}
              className={`p-2 lg:p-2.5 bg-zinc-900 border rounded cursor-grab active:cursor-grabbing transition-all flex items-center justify-between group ${
                armedTool === 'date' ? 'border-cyan-400 ring-2 ring-cyan-500/40' : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                <span>Date</span>
              </div>
              <span className="hidden lg:inline text-[10px] font-mono text-zinc-500">Drag</span>
            </div>
            </div>
          </div>

          {/* Page Overview Strip (desktop) */}
          <div className="hidden lg:block flex-1 p-4 overflow-y-auto space-y-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 mb-2 flex items-center justify-between">
              <span>Pages</span>
              <span className="text-[10px] font-mono text-zinc-500">{doc.pages.length} Pages</span>
            </div>

            {doc.pages.map((pageText, idx) => {
              const isSelected = activePageIndex === idx;
              const pageTagsCount = doc.signatureTags.filter((t) => t.pageIndex === idx).length;
              return (
                <button
                  key={idx}
                  onClick={() => setActivePageIndex(idx)}
                  className={`w-full text-left p-2.5 rounded border transition-all cursor-pointer block ${
                    isSelected
                      ? 'border-cyan-500 bg-cyan-500/10 text-white'
                      : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span>Page {idx + 1}</span>
                    {pageTagsCount > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-400">
                        {pageTagsCount} tag{pageTagsCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 line-clamp-2 font-mono leading-tight">
                    {pageText.slice(0, 100)}...
                  </div>
                </button>
              );
            })}
          </div>

          {/* Status summary (desktop) */}
          <div className="hidden lg:block p-3 border-t border-zinc-800 bg-zinc-950 text-[11px] text-zinc-400 space-y-1">
            <div className="flex justify-between">
              <span>Signatures done:</span>
              <span className="font-mono text-cyan-400 tabular-nums">
                {doc.signatureTags.length - pendingTagsCount} / {doc.signatureTags.length || 1}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="font-mono text-emerald-400 capitalize">{doc.status}</span>
            </div>
          </div>
        </div>

        {/* Main Document Viewport & Drop Canvas */}
        <div
          ref={viewportRef}
          className="flex-1 min-h-0 overflow-auto p-3 sm:p-8 flex justify-center-safe items-start bg-zinc-950"
        >
          {doc.originalFile ? (
            // Original PDF rendered exactly as uploaded, with tags overlaid
            <div style={{ zoom: pageScale }} className={`mb-16 h-fit shrink-0 ${armedTool ? 'cursor-crosshair' : ''}`}>
              <PdfPage
                docId={doc.id}
                pageIndex={activePageIndex}
                width={820}
                displayScale={pageScale}
                containerRef={documentPageRef}
                onDrop={handlePageDrop}
                onDragOver={handlePageDragOver}
                onClick={handlePageClick}
                className="rounded-sm"
              >
                {tagElements}
              </PdfPage>
            </div>
          ) : (
          <div
            ref={documentPageRef}
            onDrop={handlePageDrop}
            onDragOver={handlePageDragOver}
            onClick={handlePageClick}
            style={{ zoom: pageScale }}
            className={`paper relative shrink-0 w-205 min-h-270 bg-white text-zinc-900 rounded-sm shadow-2xl p-14 mb-16 select-text border border-zinc-300 ${
              armedTool ? 'cursor-crosshair' : ''
            }`}
          >
            {/* Page header */}
            <div className="flex items-center justify-between pb-6 border-b border-zinc-200 mb-8 text-[11px] font-mono text-zinc-500">
              <span className="tracking-widest uppercase font-semibold text-zinc-800">
                QUICKSIGN
              </span>
              <span>DOC REF: {doc.id.toUpperCase()}</span>
            </div>

            {/* Document Content */}
            <div className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-zinc-800 space-y-4">
              {doc.pages[activePageIndex]}
            </div>

            {tagElements}

            {/* Document Footer Bar with Transaction Stamping */}
            <div className="absolute bottom-6 left-14 right-14 pt-4 border-t border-zinc-200 flex items-center justify-between text-[10px] font-mono text-zinc-500">
              <span>
                {doc.transactionId ? `TRANSACTION ID: ${doc.transactionId}` : 'NOT SIGNED YET'}
              </span>
              <span>
                PAGE {activePageIndex + 1} OF {doc.pages.length}
              </span>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Signature Capture Modal */}
      <SignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        initialSignerName={userProfile.name}
        onSave={(sigUrl) => {
          setCurrentSignatureUrl(sigUrl);
        }}
      />

      {/* Success Modal after signing */}
      {signedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg p-6 text-zinc-100 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-cyan-500/20 text-cyan-400 mx-auto flex items-center justify-center border border-cyan-500/40">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white font-display">
                Document Signed
              </h3>
              <p className="text-xs text-zinc-400 mt-1">
                Your signature has been added and recorded in the audit trail.
              </p>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-md text-left text-xs font-mono space-y-1.5">
              <div className="flex justify-between">
                <span className="text-zinc-500">TRANSACTION ID:</span>
                <span className="text-cyan-400 font-bold">{signedResult.transactionId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">FINGERPRINT:</span>
                <span className="text-zinc-300 truncate max-w-50">{signedResult.sha256Hash}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">SIGNER:</span>
                <span className="text-zinc-300">{userProfile.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">TIMESTAMP:</span>
                <span className="text-zinc-400">{new Date().toISOString()}</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={handleDownloadSigned}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs rounded transition-all shadow cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Signed Document (.PDF)</span>
              </button>

              <button
                onClick={() => {
                  setSignedResult(null);
                  setActiveView('audit');
                }}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded transition-all cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>View Audit Trail</span>
              </button>

              <button
                onClick={() => {
                  setSignedResult(null);
                  setActiveView('dashboard');
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1 cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
