import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { QuickDocument } from '../types';
import { getOriginalFile } from './fileStore';
import { createTextPdf, sanitizeForFont, SCREEN_PAGE_WIDTH } from './textPdf';

// Signature images are 40px tall on the 820px-wide on-screen page; keep the same proportion in the PDF
const SCREEN_SIGNATURE_HEIGHT = 40;

/** YYYY-MM-DD in the signer's own time zone (ISO timestamps are in UTC). */
const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

// Pixels per PDF point when rasterizing signatures (~300 DPI, print quality)
const RASTER_SCALE = 300 / 72;

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/**
 * Renders a signature image to PNG bytes at the size it will be printed. Vector (SVG) signatures
 * are drawn at full print resolution, so they stay sharp however large they are.
 */
async function toPngBytes(img: HTMLImageElement, widthPt: number, heightPt: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(widthPt * RASTER_SCALE));
  canvas.height = Math.max(1, Math.round(heightPt * RASTER_SCALE));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not process signature image.');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Returns the document as a PDF with every completed tag stamped onto its page:
 * the original upload when one is stored, otherwise the document text laid out as a PDF.
 */
export async function buildSignedPdf(doc: QuickDocument, originalPdf?: Blob): Promise<Blob> {
  let pdf: PDFDocument;
  let pdfPageFor = (pageIndex: number) => pageIndex;

  if (doc.originalFile) {
    const original = originalPdf || (await getOriginalFile(doc.id));
    if (!original) throw new Error('Original PDF not found on this device.');
    pdf = await PDFDocument.load(await original.arrayBuffer());
  } else {
    const built = await createTextPdf(doc.pages, {
      headerLeft: 'QUICKSIGN',
      headerRight: `DOC REF: ${doc.id.toUpperCase()}`,
      footerLeft: doc.transactionId ? `TRANSACTION ID: ${doc.transactionId}` : doc.title,
    });
    pdf = built.pdf;
    pdfPageFor = (pageIndex) => built.sectionPages[pageIndex];
  }

  pdf.setTitle(doc.title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const tag of doc.signatureTags) {
    if (!tag.isCompleted && tag.type === 'signature') continue;
    const page = pages[pdfPageFor(tag.pageIndex)];
    if (!page) continue;

    const { width, height } = page.getSize();
    const unit = width / SCREEN_PAGE_WIDTH; // PDF points per on-screen pixel
    const cx = (tag.x / 100) * width;
    const cy = height - (tag.y / 100) * height; // PDF origin is bottom-left

    if (tag.type === 'signature' && tag.signatureDataUrl) {
      const source = await loadImage(tag.signatureDataUrl);
      const h = SCREEN_SIGNATURE_HEIGHT * (tag.scale ?? 1) * unit;
      const w = ((source.naturalWidth || 4) / (source.naturalHeight || 1)) * h;
      const image = await pdf.embedPng(await toPngBytes(source, w, h));
      page.drawImage(image, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });

      const caption = sanitizeForFont(
        `Signed: ${tag.signerName}${tag.completedAt ? ` · ${localDate(tag.completedAt)}` : ''}`,
        font
      );
      const size = 6 * unit;
      page.drawText(caption, {
        x: cx - font.widthOfTextAtSize(caption, size) / 2,
        y: cy - h / 2 - size - 2 * unit,
        size,
        font,
        color: rgb(0.02, 0.59, 0.41),
      });
    } else if (tag.type === 'date' || tag.type === 'nameTag') {
      const text = sanitizeForFont(
        tag.type === 'date'
          ? localDate(tag.completedAt || doc.signedAt || new Date().toISOString())
          : `Signer: ${tag.signerName}`,
        font
      );
      const size = 9 * unit;
      page.drawText(text, {
        x: cx - font.widthOfTextAtSize(text, size) / 2,
        y: cy - size / 2,
        size,
        font,
        color: rgb(0.1, 0.1, 0.12),
      });
    }
  }

  return new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' });
}
