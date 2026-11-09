import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getOriginalFile } from './fileStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib };

// One parsed PDF per document, shared by every page view
const cache = new Map<string, Promise<PDFDocumentProxy>>();

export function loadStoredPdf(docId: string): Promise<PDFDocumentProxy> {
  let promise = cache.get(docId);
  if (!promise) {
    promise = getOriginalFile(docId).then(async (blob) => {
      if (!blob) throw new Error('Original file not found on this device.');
      return pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    });
    promise.catch(() => cache.delete(docId));
    cache.set(docId, promise);
  }
  return promise;
}

// PDFs held only in memory (e.g. converter previews), parsed once per Blob
const blobCache = new WeakMap<Blob, Promise<PDFDocumentProxy>>();

export function loadPdfFromBlob(blob: Blob): Promise<PDFDocumentProxy> {
  let promise = blobCache.get(blob);
  if (!promise) {
    promise = blob.arrayBuffer().then((buf) => pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise);
    blobCache.set(blob, promise);
  }
  return promise;
}

export function forgetStoredPdf(docId: string) {
  cache.get(docId)?.then((pdf) => pdf.loadingTask.destroy()).catch(() => {});
  cache.delete(docId);
}
