import React, { useEffect, useRef, useState } from 'react';
import type { RenderTask } from 'pdfjs-dist';
import { loadStoredPdf, loadPdfFromBlob } from '../../lib/pdf';
import { RefreshCw, AlertCircle } from 'lucide-react';

interface PdfPageProps {
  /** Stored document whose original PDF to show */
  docId?: string;
  /** Or an in-memory PDF (used by converter previews) */
  file?: Blob;
  pageIndex: number;
  /** CSS width of the rendered page in pixels; height follows the page's aspect ratio */
  width: number;
  /**
   * On-screen scale applied by a parent (CSS zoom), so the canvas is rendered at the size it is
   * actually shown and stays sharp on small screens and when zoomed in.
   */
  displayScale?: number;
  containerRef?: React.Ref<HTMLDivElement>;
  className?: string;
  /** Overlay content (signature tags etc.), positioned against the page box */
  children?: React.ReactNode;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

/** Renders one page of the stored original PDF exactly as it appears in the file. */
export const PdfPage: React.FC<PdfPageProps> = ({
  docId,
  file,
  pageIndex,
  width,
  displayScale = 1,
  containerRef,
  className = '',
  children,
  onDrop,
  onDragOver,
  onClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [aspect, setAspect] = useState<number | null>(null); // height / width
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    setError(null);

    const source = file
      ? loadPdfFromBlob(file)
      : docId
      ? loadStoredPdf(docId)
      : Promise.reject(new Error('No PDF to display.'));

    source
      .then(async (pdf) => {
        if (pageIndex >= pdf.numPages) throw new Error('Page not found in original file.');
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled || !canvasRef.current) return;

        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);

        // Render at device resolution so text stays sharp
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (width * displayScale * dpr) / base.width });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        task = page.render({ canvas, viewport });
        await task.promise;
      })
      .catch((err) => {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          setError(err?.message || 'Unable to display this page.');
        }
      });

    return () => {
      cancelled = true;
      task?.cancel();
    };
    // Round so tiny resize steps don't trigger a re-render of the page
  }, [docId, file, pageIndex, width, Math.round(displayScale * 20)]);

  return (
    <div
      ref={containerRef}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onClick={onClick}
      style={{ width, height: aspect ? width * aspect : width * 1.294 }}
      className={`paper relative bg-white shadow-2xl ${className}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {!aspect && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center text-zinc-600">
          <AlertCircle className="w-5 h-5 text-rose-500" />
          <p className="text-xs">{error}</p>
        </div>
      )}

      {children}
    </div>
  );
};
