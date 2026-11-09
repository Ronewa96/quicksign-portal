import React, { useEffect, useRef, useState } from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { getOriginalFile } from '../../lib/fileStore';
import { loadPdfFromBlob } from '../../lib/pdf';
import { downloadBlob } from '../../lib/textPdf';
import { PdfPage } from '../viewer/PdfPage';
import { useElementWidth } from '../../lib/useElementWidth';
import {
  RefreshCw,
  Download,
  FileText,
  Upload,
  ArrowRight,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  X,
} from 'lucide-react';

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word (.docx)',
  doc: 'Word 97-2003 (.doc)',
  odt: 'OpenDocument Text (.odt)',
  rtf: 'Rich Text (.rtf)',
  txt: 'Plain Text (.txt)',
  html: 'Web Page (.html)',
  htm: 'Web Page (.htm)',
  xlsx: 'Excel (.xlsx)',
  xls: 'Excel 97-2003 (.xls)',
  ods: 'OpenDocument Spreadsheet (.ods)',
  csv: 'CSV (.csv)',
  pptx: 'PowerPoint (.pptx)',
  ppt: 'PowerPoint 97-2003 (.ppt)',
  odp: 'OpenDocument Presentation (.odp)',
};

interface ConverterStatus {
  available: boolean;
  pdfToWord: 'pdf2docx' | 'libreoffice';
  targets: Record<string, string[]>;
  families: Record<string, string>;
}

const getExt = (name: string) => name.split('.').pop()?.toLowerCase() || '';
const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** One PDF page at a time with page navigation. */
const PdfPreview: React.FC<{ file: Blob; label: string }> = ({ file, label }) => {
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  // Up to 420px wide, narrower on phones
  const [containerRef, containerWidth] = useElementWidth();
  const pageWidth = Math.min(420, containerWidth || 420);

  useEffect(() => {
    setPage(0);
    loadPdfFromBlob(file)
      .then((pdf) => setPageCount(pdf.numPages))
      .catch(() => setPageCount(1));
  }, [file]);

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-3 min-w-0">
      <div className="w-full flex items-center justify-between text-xs text-zinc-400">
        <span className="font-semibold text-zinc-200">{label}</span>
        <div className="flex items-center gap-1 font-mono text-[11px]">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 hover:text-white disabled:opacity-30 cursor-pointer"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span>
            {page + 1} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="p-1 hover:text-white disabled:opacity-30 cursor-pointer"
            aria-label="Next page"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <PdfPage file={file} pageIndex={page} width={pageWidth} className="rounded-sm" />
    </div>
  );
};

/** Card for files that cannot be previewed in the browser. */
const FileCard: React.FC<{ name: string; size: number; label: string; note?: string }> = ({ name, size, label, note }) => (
  <div className="flex flex-col gap-3">
    <span className="text-xs font-semibold text-zinc-200">{label}</span>
    <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col items-center justify-center gap-2 text-center min-h-48">
      <FileText className="w-8 h-8 text-cyan-400" />
      <div className="text-sm font-semibold text-white break-all">{name}</div>
      <div className="text-xs text-zinc-500">
        {FORMAT_LABELS[getExt(name)] || getExt(name).toUpperCase()} · {formatSize(size)}
      </div>
      {note && <p className="text-[11px] text-zinc-500 max-w-xs mt-1">{note}</p>}
    </div>
  </div>
);

export const DocumentConverter: React.FC = () => {
  const { documents } = useDocuments();
  const storedDocs = documents.filter((d) => d.originalFile);

  const [status, setStatus] = useState<ConverterStatus | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [target, setTarget] = useState<string>('');
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch('/api/convert/status')
      .then((res) => (res.ok ? res.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const sourceExt = source ? getExt(source.name) : '';
  const family = status?.families[sourceExt];
  const targets = family ? status!.targets[family] : [];
  const acceptList = status ? Object.keys(status.families).map((e) => `.${e}`).join(',') : '';

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    const ext = getExt(file.name);
    if (status && !status.families[ext]) {
      setError(`Files of type ".${ext}" can't be converted. Try PDF, Word, Excel, PowerPoint, OpenDocument, RTF, HTML, or text.`);
      return;
    }
    setSource(file);
    const options = status ? status.targets[status.families[ext]] : [];
    setTarget(options[0] || '');
  };

  const openStoredDocument = async (docId: string) => {
    const doc = documents.find((d) => d.id === docId);
    if (!doc?.originalFile) return;
    try {
      const blob = await getOriginalFile(doc.id);
      if (!blob) throw new Error('The original file is not stored on this device.');
      chooseFile(new File([blob], doc.originalFile.name, { type: doc.originalFile.mimeType }));
    } catch (err: any) {
      setError(err?.message || 'Could not open this document.');
    }
  };

  const handleConvert = async () => {
    if (!source || !target) return;
    setIsConverting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/convert/file?name=${encodeURIComponent(source.name)}&to=${encodeURIComponent(target)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: source }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : data.error || 'Conversion failed.');
      }
      const name = decodeURIComponent(res.headers.get('X-Filename') || `document.${target}`);
      setResult({ blob: await res.blob(), name });
    } catch (err: any) {
      setError(err?.message || 'Conversion failed.');
    } finally {
      setIsConverting(false);
    }
  };

  const reset = () => {
    setSource(null);
    setResult(null);
    setError(null);
    setTarget('');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-y-auto">
      {/* Header bar */}
      <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-zinc-800/80 bg-zinc-950/40">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-cyan-400" />
              <h1 className="text-xl font-bold tracking-tight text-white font-display">File Converter</h1>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Converts documents while keeping their original layout, fonts, tables, and images. Files are converted on
              this server and are not sent anywhere else.
            </p>
          </div>
          {source && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Convert Another File</span>
            </button>
          )}
        </div>
      </div>

      <div className="max-w-6xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {status && !status.available && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The conversion engine (LibreOffice) is not installed on the server, so files can't be converted yet. Install
              LibreOffice from libreoffice.org and restart the server.
            </span>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!source ? (
          /* Step 1: choose a file */
          <div className="space-y-5">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                chooseFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center justify-center gap-3 p-8 sm:p-12 rounded-lg border-2 border-dashed text-center cursor-pointer transition-colors ${
                isDragOver ? 'border-cyan-400 bg-cyan-500/10' : 'border-zinc-700 bg-zinc-950 hover:border-cyan-500/60'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept={acceptList}
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center">
                <Upload className="w-5 h-5" />
              </div>
              <span className="text-sm font-semibold text-white">Drop a file here or click to upload</span>
              <span className="text-xs text-zinc-500">
                PDF, Word, Excel, PowerPoint, OpenDocument, RTF, HTML, or text · up to 50 MB
              </span>
            </label>

            {storedDocs.length > 0 && (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                  Or convert one of your documents
                </div>
                <div className="flex flex-wrap gap-2">
                  {storedDocs.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => openStoredDocument(d.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white cursor-pointer max-w-full"
                    >
                      <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span className="truncate">{d.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Step 2: choose a format and convert */}
            <div className="p-5 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-6 h-6 text-cyan-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{source.name}</div>
                  <div className="text-xs text-zinc-500">
                    {FORMAT_LABELS[sourceExt] || sourceExt.toUpperCase()} · {formatSize(source.size)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <ArrowRight className="w-4 h-4 text-zinc-500 hidden lg:block" />
                <span className="text-xs text-zinc-400">Convert to:</span>
                {targets.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTarget(t);
                      setResult(null);
                    }}
                    disabled={isConverting}
                    className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer font-mono ${
                      target === t
                        ? 'bg-cyan-500 text-zinc-950 font-bold'
                        : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                    }`}
                    title={FORMAT_LABELS[t]}
                  >
                    .{t.toUpperCase()}
                  </button>
                ))}
                <button
                  onClick={handleConvert}
                  disabled={isConverting || !target || status?.available === false}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-semibold rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isConverting ? 'animate-spin' : ''}`} />
                  <span>{isConverting ? 'Converting…' : 'Convert'}</span>
                </button>
              </div>
            </div>

            {sourceExt === 'pdf' && target && target !== 'pdf' && (
              <p className="text-[11px] text-zinc-500">
                {status?.pdfToWord === 'pdf2docx'
                  ? 'PDFs are rebuilt as editable documents with their paragraphs, tables, and images. Scanned PDFs (pictures of pages) cannot be turned into editable text.'
                  : 'Converting a PDF to an editable format is approximate: text is placed in positioned boxes and some formatting may shift. Scanned PDFs cannot be turned into editable text.'}
              </p>
            )}

            {/* Result */}
            {result && (
              <div className="p-4 bg-emerald-950/20 border border-emerald-500/30 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Converted to <span className="font-semibold">{result.name}</span> ({formatSize(result.blob.size)})
                  </span>
                </div>
                <button
                  onClick={() => downloadBlob(result.blob, result.name)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-semibold rounded cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              </div>
            )}

            {/* Side-by-side preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {sourceExt === 'pdf' ? (
                <PdfPreview file={source} label="Original" />
              ) : (
                <FileCard
                  name={source.name}
                  size={source.size}
                  label="Original"
                  note="A preview of this file type isn't available in the browser."
                />
              )}

              {isConverting ? (
                <div className="flex flex-col items-center justify-center gap-2 min-h-48 text-xs text-zinc-500">
                  <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                  <span>Converting… this can take a few seconds.</span>
                </div>
              ) : result ? (
                getExt(result.name) === 'pdf' ? (
                  <PdfPreview file={result.blob} label="Converted" />
                ) : (
                  <FileCard
                    name={result.name}
                    size={result.blob.size}
                    label="Converted"
                    note="Download the file and open it in Word, Excel, PowerPoint, or LibreOffice to view it."
                  />
                )
              ) : (
                <div className="flex items-center justify-center min-h-48 text-xs text-zinc-600 italic border border-dashed border-zinc-800 rounded-lg">
                  Choose a format and click Convert
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
