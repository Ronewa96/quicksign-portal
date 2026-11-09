import { readDocumentFile, extractTextFromFile, SUPPORTED_EXTENSIONS } from './extractText';

// Office formats are converted to PDF on the server so they display exactly as they look in Word, Excel, etc.
const CONVERT_TO_PDF_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf', 'html', 'htm', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'];

export const UPLOAD_EXTENSIONS = Array.from(new Set([...SUPPORTED_EXTENSIONS, ...CONVERT_TO_PDF_EXTENSIONS]));
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export interface PreparedDocument {
  /** PDF to keep and display as-is (the upload itself, or a PDF made from it) */
  pdfFile?: File;
  /** One text entry per page (real PDF pages when a PDF is kept) */
  pages: string[];
  text: string;
}

const getExtension = (name: string) => name.split('.').pop()?.toLowerCase() || '';
const baseName = (name: string) => name.replace(/\.[^/.]+$/, '') || 'document';

/** Splits plain text into pages of roughly 1200 characters, breaking between paragraphs. */
export function splitTextIntoPages(text: string): string[] {
  const pages: string[] = [];
  let current = '';
  for (const paragraph of text.split('\n\n')) {
    if (current && (current + '\n\n' + paragraph).length > 1200) {
      pages.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) pages.push(current);
  return pages.length > 0 ? pages : [text];
}

async function convertToPdfOnServer(file: File): Promise<File> {
  const res = await fetch(`/api/convert/file?name=${encodeURIComponent(file.name)}&to=pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Conversion to PDF failed.');
  }
  return new File([await res.blob()], `${baseName(file.name)}.pdf`, { type: 'application/pdf' });
}

async function fromPdf(pdfFile: File): Promise<PreparedDocument> {
  const { text, pdfPages } = await readDocumentFile(pdfFile);
  return { pdfFile, pages: pdfPages || [text], text };
}

/**
 * Prepares an uploaded file for storage so it can be shown exactly as it looks.
 * Falls back to plain text when the file can't be converted.
 */
export async function prepareDocumentUpload(file: File): Promise<PreparedDocument> {
  const ext = getExtension(file.name);
  if (!UPLOAD_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type ".${ext}". Upload a PDF, Word, Excel, PowerPoint, OpenDocument, RTF, HTML, or text file.`);
  }

  if (ext === 'pdf') return fromPdf(file);

  if (CONVERT_TO_PDF_EXTENSIONS.includes(ext)) {
    try {
      return await fromPdf(await convertToPdfOnServer(file));
    } catch (err) {
      // Fall back to the text content if this type can be read directly
      if (!SUPPORTED_EXTENSIONS.includes(ext)) throw err;
      console.warn('Original layout unavailable, using text only:', err);
    }
  }

  const text = await extractTextFromFile(file);
  return { pages: splitTextIntoPages(text), text };
}
