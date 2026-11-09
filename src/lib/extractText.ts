import mammoth from 'mammoth';
import { pdfjsLib } from './pdf';

export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'html', 'htm', 'json'];
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

const getExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || '';

/** Text of each PDF page, in order (empty strings for image-only pages). */
async function extractPdfPages(file: File): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n');
      pages.push(text.trim());
    }
    return pages;
  } finally {
    pdf.loadingTask.destroy();
  }
}

async function extractPdf(file: File): Promise<string> {
  return (await extractPdfPages(file)).join('\n\n');
}

export const isPdfFile = (file: File) => getExtension(file.name) === 'pdf';

/**
 * Reads a document for storage. PDFs keep one text entry per real page and may have no text
 * (scanned pages still display from the original file); other formats return only text.
 */
export async function readDocumentFile(file: File): Promise<{ text: string; pdfPages?: string[] }> {
  if (isPdfFile(file)) {
    if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than 15 MB.');
    const pdfPages = await extractPdfPages(file);
    return { text: pdfPages.join('\n\n').trim(), pdfPages };
  }
  return { text: await extractTextFromFile(file) };
}

async function extractDocx(file: File): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body?.innerText || doc.body?.textContent || '';
}

/** Extracts readable text from an uploaded document. Throws a user-facing error on failure. */
export async function extractTextFromFile(file: File): Promise<string> {
  const ext = getExtension(file.name);

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type ".${ext}". Upload a PDF, DOCX, TXT, MD, HTML, or JSON file.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File is larger than 15 MB.');
  }

  let text: string;
  if (ext === 'pdf') {
    text = await extractPdf(file);
  } else if (ext === 'docx') {
    text = await extractDocx(file);
  } else if (ext === 'html' || ext === 'htm') {
    text = stripHtml(await file.text());
  } else {
    text = await file.text();
  }

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) {
    throw new Error(
      ext === 'pdf'
        ? 'No readable text found. This PDF may be a scanned image, which is not supported yet.'
        : 'The file appears to be empty.'
    );
  }
  return text;
}
