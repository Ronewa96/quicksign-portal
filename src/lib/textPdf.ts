import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

// Same proportions as the on-screen document page (820 × 1080 px), so tag positions carry over
export const SCREEN_PAGE_WIDTH = 820;
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = Math.round((PAGE_WIDTH * 1080) / SCREEN_PAGE_WIDTH);
const UNIT = PAGE_WIDTH / SCREEN_PAGE_WIDTH; // PDF points per on-screen pixel

const MARGIN_X = 56 * UNIT;
const MARGIN_TOP = 56 * UNIT;
const MARGIN_BOTTOM = 72 * UNIT;
const HEADER_SPACE = 70 * UNIT;

export interface TextPdfOptions {
  /** Small caps line at the top-left of every page */
  headerLeft?: string;
  headerRight?: string;
  footerLeft?: string;
  monospace?: boolean;
  fontSize?: number;
}

/** Replaces characters the standard PDF fonts cannot encode. */
export function sanitizeForFont(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\r/g, '').replace(/\t/g, '    '))
    .map((ch) => (ch === '\n' || supported.has(ch.codePointAt(0)!) ? ch : '?'))
    .join('');
}

function wrapLine(line: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!line) return [''];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(/(\s+)/)) {
    const candidate = current + word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.trim()) out.push(current.trimEnd());
    current = word.trimStart();
    // Break words longer than a full line
    while (font.widthOfTextAtSize(current, size) > maxWidth) {
      let cut = current.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) cut--;
      out.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  out.push(current.trimEnd());
  return out;
}

/**
 * Lays out text as a PDF. Each section starts on a new page (flowing onto more pages if long).
 * Returns the PDF and the page index where each section starts.
 */
export async function createTextPdf(
  sections: string[],
  options: TextPdfOptions = {}
): Promise<{ pdf: PDFDocument; sectionPages: number[] }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(options.monospace ? StandardFonts.Courier : StandardFonts.Helvetica);
  const meta = await pdf.embedFont(StandardFonts.Courier);
  const size = options.fontSize ?? 13 * UNIT;
  const lineHeight = size * 1.6;
  const maxWidth = PAGE_WIDTH - MARGIN_X * 2;
  const grey = rgb(0.45, 0.45, 0.48);

  const sectionPages: number[] = [];
  let page: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN_TOP;
    if (options.headerLeft || options.headerRight) {
      const hs = 8 * UNIT * 1.2;
      if (options.headerLeft) {
        page.drawText(sanitizeForFont(options.headerLeft, meta), { x: MARGIN_X, y: y - hs, size: hs, font: meta, color: grey });
      }
      if (options.headerRight) {
        const t = sanitizeForFont(options.headerRight, meta);
        page.drawText(t, { x: PAGE_WIDTH - MARGIN_X - meta.widthOfTextAtSize(t, hs), y: y - hs, size: hs, font: meta, color: grey });
      }
      page.drawLine({
        start: { x: MARGIN_X, y: y - hs - 14 * UNIT },
        end: { x: PAGE_WIDTH - MARGIN_X, y: y - hs - 14 * UNIT },
        thickness: 0.5,
        color: rgb(0.88, 0.88, 0.9),
      });
      y -= HEADER_SPACE;
    }
  };

  for (const section of sections.length ? sections : ['']) {
    newPage();
    sectionPages.push(pdf.getPageCount() - 1);
    const text = sanitizeForFont(section, font);
    for (const rawLine of text.split('\n')) {
      for (const line of wrapLine(rawLine, font, size, maxWidth)) {
        if (y - lineHeight < MARGIN_BOTTOM) newPage();
        y -= lineHeight;
        if (line) page!.drawText(line, { x: MARGIN_X, y, size, font, color: rgb(0.12, 0.12, 0.14) });
      }
    }
  }

  // Footer with page numbers
  const pages = pdf.getPages();
  const fs = 7 * UNIT * 1.2;
  pages.forEach((p, i) => {
    const right = `PAGE ${i + 1} OF ${pages.length}`;
    p.drawText(right, { x: PAGE_WIDTH - MARGIN_X - meta.widthOfTextAtSize(right, fs), y: 30 * UNIT, size: fs, font: meta, color: grey });
    if (options.footerLeft) {
      p.drawText(sanitizeForFont(options.footerLeft, meta), { x: MARGIN_X, y: 30 * UNIT, size: fs, font: meta, color: grey });
    }
  });

  return { pdf, sectionPages };
}

export async function textToPdfBlob(text: string, options?: TextPdfOptions): Promise<Blob> {
  const { pdf } = await createTextPdf([text], options);
  return new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'document';
