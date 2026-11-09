import React, { useState, useMemo, useRef } from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { prepareDocumentUpload, UPLOAD_ACCEPT } from '../../lib/importDocument';
import { saveOriginalFile } from '../../lib/fileStore';
import { useElementWidth, fitScale } from '../../lib/useElementWidth';
import { PdfPage } from './PdfPage';
import { buildSignedPdf } from '../../lib/signedPdf';
import { downloadBlob, safeFileName } from '../../lib/textPdf';
import {
  ZoomIn,
  ZoomOut,
  Search,
  Maximize2,
  Minimize2,
  Copy,
  Printer,
  PenTool,
  Sparkles,
  FileText,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Check,
  ShieldCheck,
  Download,
  Upload,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

export const DocumentViewer: React.FC = () => {
  const {
    documents,
    activeDocumentId,
    setActiveDocumentId,
    openDedicatedSigning,
    setActiveView,
    addDocument,
  } = useDocuments();

  const doc = documents.find((d) => d.id === activeDocumentId) || documents[0];

  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [searchTerm, setSearchTerm] = useState('');
  const [paperTheme, setPaperTheme] = useState<'white' | 'dark'>('white');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  // Search occurrences
  const totalPages = doc?.pages.length || 1;

  const currentContent = useMemo(() => {
    if (!doc || !doc.pages[currentPage]) return '';
    return doc.pages[currentPage];
  }, [doc, currentPage]);

  const handleCopy = () => {
    if (!doc) return;
    navigator.clipboard.writeText(doc.rawText || doc.pages.join('\n\n'));
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  const [isDownloading, setIsDownloading] = useState(false);

  // Downloads the document as a PDF (original layout when available) with completed signatures
  const handleDownloadPdf = async () => {
    if (!doc) return;
    setIsDownloading(true);
    try {
      downloadBlob(await buildSignedPdf(doc), `${safeFileName(doc.title)}.pdf`);
    } catch (err: any) {
      window.alert(err?.message || 'Could not generate the PDF.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pages are laid out at a fixed 840px and scaled to fit the screen, then by the zoom level
  const [viewportRef, viewportWidth] = useElementWidth();
  const pageScale = fitScale(viewportWidth, 840, zoom / 100);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Adds an uploaded file to the user's documents and opens it here
  const handleUpload = async (file: File | undefined) => {
    if (!file || isUploading) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      const prepared = await prepareDocumentUpload(file);
      const id = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      // Store the original first so the page can render as soon as the document appears
      if (prepared.pdfFile) await saveOriginalFile(id, prepared.pdfFile);

      const ext = file.name.split('.').pop()?.toLowerCase();
      addDocument({
        id,
        title: file.name.replace(/\.[^/.]+$/, ''),
        category: 'Other',
        fileType: ext === 'docx' || ext === 'txt' || ext === 'md' || ext === 'json' ? ext : 'pdf',
        rawText: prepared.text,
        pages: prepared.pages,
        originalFile: prepared.pdfFile
          ? { name: prepared.pdfFile.name, mimeType: 'application/pdf', size: prepared.pdfFile.size }
          : undefined,
        status: 'draft',
      });
      setCurrentPage(0);
    } catch (err: any) {
      setUploadError(err?.message || 'Could not open this file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: () => setIsDragOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setIsDragOver(false);
      handleUpload(e.dataTransfer.files?.[0]);
    },
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept={UPLOAD_ACCEPT}
      onChange={(e) => handleUpload(e.target.files?.[0])}
      className="hidden"
    />
  );

  const uploadErrorBanner = uploadError && (
    <div role="alert" className="flex items-start gap-2 p-3 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{uploadError}</span>
      <button onClick={() => setUploadError(null)} className="text-rose-400 hover:text-rose-200 cursor-pointer" aria-label="Dismiss">
        ×
      </button>
    </div>
  );

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-zinc-950">
        <div className="w-full max-w-xl space-y-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            {...dropHandlers}
            className={`w-full flex flex-col items-center justify-center gap-3 p-8 sm:p-12 rounded-lg border-2 border-dashed text-center transition-colors ${
              isUploading ? 'cursor-wait' : 'cursor-pointer'
            } ${isDragOver ? 'border-cyan-400 bg-cyan-500/10' : 'border-zinc-700 bg-zinc-950 hover:border-cyan-500/60'}`}
          >
            {isUploading ? (
              <>
                <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                <span className="text-sm font-semibold text-white">Opening document…</span>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <span className="text-sm font-semibold text-white">Drop a document here or click to upload</span>
                <span className="text-xs text-zinc-500">PDF, Word, Excel, PowerPoint, OpenDocument, RTF, HTML, or text</span>
              </>
            )}
          </button>
          {fileInput}
          {uploadErrorBanner}
        </div>
      </div>
    );
  }

  // Highlight search matches
  const renderHighlightedContent = (text: string) => {
    if (!searchTerm.trim()) return text;

    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-cyan-500/30 text-cyan-200 px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const signatureOverlays = doc.signatureTags
    .filter((t) => t.pageIndex === currentPage && t.isCompleted && t.signatureDataUrl)
    .map((sig) => (
      <div
        key={sig.id}
        style={{
          position: 'absolute',
          left: `${sig.x}%`,
          top: `${sig.y}%`,
        }}
        className="-translate-x-1/2 -translate-y-1/2 p-2 rounded border border-emerald-500/40 bg-emerald-500/5 text-center"
      >
        <img
          src={sig.signatureDataUrl}
          alt="Verified Signature"
          style={{ height: 40 * (sig.scale ?? 1) }}
          className="w-auto max-w-none object-contain drop-shadow"
        />
        <div className="text-[9px] font-mono text-emerald-600 mt-1 flex items-center gap-1 justify-center">
          <ShieldCheck className="w-3 h-3" />
          <span>Signed by: {sig.signerName}</span>
        </div>
      </div>
    ));

  return (
    <div className={`flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Document toolbar */}
      <div className="min-h-14 py-2 border-b border-zinc-800 bg-zinc-950 px-3 sm:px-6 flex flex-wrap items-center justify-between shrink-0 gap-2 sm:gap-4">
        {/* Document Quick Switcher & Title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
            <select
              value={doc.id}
              onChange={(e) => {
                setActiveDocumentId(e.target.value);
                setCurrentPage(0);
              }}
              className="bg-zinc-900 border border-zinc-800 text-xs font-semibold text-white rounded px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 max-w-[60vw] sm:max-w-xs truncate cursor-pointer"
            >
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({d.fileType.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
            <span>{doc.category}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize text-cyan-400">{doc.status}</span>
          </div>
        </div>

        {/* Universal Controls: Zoom, Page Nav, Search, Mode (scrolls sideways on narrow screens) */}
        <div className="flex items-center gap-1.5 sm:gap-2 max-w-full overflow-x-auto">
          {/* Upload a new document */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-700 text-zinc-200 hover:text-white text-xs rounded transition-colors cursor-pointer disabled:opacity-50"
            title="Upload a document"
          >
            {isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" /> : <Upload className="w-3.5 h-3.5 text-cyan-400" />}
            <span className="hidden sm:inline">{isUploading ? 'Opening…' : 'Upload'}</span>
          </button>
          {fileInput}

          {/* In-Document Search */}
          <div className="relative hidden md:block">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Find in text..."
              className="w-36 pl-8 pr-2.5 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500 transition-all focus:w-48"
            />
          </div>

          {/* Page Selector */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-300">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-1 hover:text-white disabled:opacity-30 cursor-pointer"
              title="Previous Page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] px-1 whitespace-nowrap">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="p-1 hover:text-white disabled:opacity-30 cursor-pointer"
              title="Next Page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-300">
            <button
              onClick={() => setZoom((z) => Math.max(60, z - 15))}
              className="p-1 hover:text-white cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] w-9 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(180, z + 15))}
              className="p-1 hover:text-white cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Paper theme toggle */}
          <button
            onClick={() => setPaperTheme((t) => (t === 'white' ? 'dark' : 'white'))}
            className="hidden sm:block p-2 bg-zinc-900 border border-zinc-800 rounded hover:text-white text-zinc-400 transition-colors cursor-pointer"
            title={paperTheme === 'white' ? 'Switch to Dark Paper' : 'Switch to White Paper'}
          >
            {paperTheme === 'white' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          </button>

          {/* Copy Text */}
          <button
            onClick={handleCopy}
            className="hidden sm:block p-2 bg-zinc-900 border border-zinc-800 rounded hover:text-white text-zinc-400 transition-colors cursor-pointer"
            title="Copy Text"
          >
            {hasCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Download as PDF */}
          <button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="p-2 bg-zinc-900 border border-zinc-800 rounded hover:text-white text-zinc-400 transition-colors cursor-pointer disabled:opacity-50"
            title="Download PDF"
            aria-label="Download PDF"
          >
            <Download className={`w-3.5 h-3.5 ${isDownloading ? 'animate-pulse' : ''}`} />
          </button>

          {/* Print */}
          <button
            onClick={handlePrint}
            className="hidden sm:block p-2 bg-zinc-900 border border-zinc-800 rounded hover:text-white text-zinc-400 transition-colors cursor-pointer"
            title="Print Document"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="hidden sm:block p-2 bg-zinc-900 border border-zinc-800 rounded hover:text-white text-zinc-400 transition-colors cursor-pointer"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Action CTAs */}
          <button
            onClick={() => {
              setActiveView('ai');
            }}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-700 text-cyan-300 hover:text-white text-xs rounded transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Ask AI</span>
          </button>

          <button
            onClick={() => openDedicatedSigning(doc.id)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-zinc-950 font-semibold text-xs rounded hover:bg-zinc-200 transition-all cursor-pointer shadow-sm"
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Sign</span>
          </button>
        </div>
      </div>

      {uploadErrorBanner && <div className="px-3 sm:px-6 pt-3">{uploadErrorBanner}</div>}

      {/* Document Viewport Canvas (files can be dropped here to upload) */}
      <div
        ref={viewportRef}
        {...dropHandlers}
        className={`flex-1 overflow-auto p-3 sm:p-8 flex justify-center-safe items-start bg-zinc-950 ${isDragOver ? 'outline-2 outline-dashed outline-cyan-400 -outline-offset-8' : ''}`}
      >
        {doc.originalFile ? (
          // Original PDF rendered exactly as uploaded, with completed signatures overlaid
          <div style={{ zoom: pageScale }} className="h-fit shrink-0">
            <PdfPage docId={doc.id} pageIndex={currentPage} width={840} displayScale={pageScale} className="rounded">
              {signatureOverlays}
            </PdfPage>
          </div>
        ) : (
        <div
          style={{ zoom: pageScale }}
          className={`paper relative shrink-0 w-[840px] min-h-[1100px] rounded shadow-2xl p-16 border ${
            paperTheme === 'white'
              ? 'bg-white text-zinc-900 border-zinc-300'
              : 'bg-[#101217] text-zinc-100 border-zinc-800'
          }`}
        >
          {/* Formal Document Header */}
          <div className="flex items-center justify-between pb-6 border-b border-zinc-200 mb-8 text-[11px] font-mono opacity-60">
            <span className="tracking-widest uppercase font-semibold">
              QUICKSIGN
            </span>
            <span>IDENTIFIER: {doc.id}</span>
          </div>

          {/* Rendered Text with Highlighting */}
          <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed tracking-normal select-text">
            {renderHighlightedContent(currentContent)}
          </div>

          {/* Render Any Completed Signatures on this Page */}
          {signatureOverlays}

          {/* Formal Footer */}
          <div className="absolute bottom-6 left-16 right-16 pt-4 border-t border-zinc-200 flex items-center justify-between text-[10px] font-mono opacity-50">
            <span>
              {doc.transactionId ? `TRANSACTION ID: ${doc.transactionId}` : doc.category}
            </span>
            <span>
              PAGE {currentPage + 1} OF {totalPages}
            </span>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
