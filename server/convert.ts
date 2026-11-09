import express from 'express';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Layout-preserving document conversion using LibreOffice (free, runs locally, files never leave the machine)

const CONVERSION_TIMEOUT_MS = 120_000;
const MAX_UPLOAD = '50mb';

type Family = 'pdf' | 'text' | 'sheet' | 'slides';

const FAMILY_BY_EXT: Record<string, Family> = {
  pdf: 'pdf',
  docx: 'text', doc: 'text', odt: 'text', rtf: 'text', txt: 'text', html: 'text', htm: 'text',
  xlsx: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet',
  pptx: 'slides', ppt: 'slides', odp: 'slides',
};

// Formats each kind of document can be converted to
export const TARGETS_BY_FAMILY: Record<Family, string[]> = {
  pdf: ['docx', 'odt', 'rtf'],
  text: ['pdf', 'docx', 'odt', 'rtf', 'html', 'txt'],
  sheet: ['pdf', 'xlsx', 'ods', 'csv', 'html'],
  slides: ['pdf', 'pptx', 'odp'],
};

// LibreOffice export filters (format:FilterName[:options])
const EXPORT_FILTER: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  odt: 'odt',
  rtf: 'rtf',
  html: 'html',
  txt: 'txt:Text (encoded):UTF8',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  ods: 'ods',
  csv: 'csv',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  odp: 'odp',
};

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  html: 'text/html',
  txt: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

function findSoffice(): string | null {
  const candidates = [
    process.env.SOFFICE_PATH,
    // soffice.com waits for the conversion to finish on Windows (soffice.exe returns immediately)
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.com'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.com'),
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// Python with pdf2docx (project .venv) gives much better PDF -> Word results than LibreOffice's PDF import
const PDF_TO_DOCX_SCRIPT = path.resolve(process.cwd(), 'server', 'pdf_to_docx.py');

function findPython(): string | null {
  const venv = path.resolve(process.cwd(), '.venv');
  const candidates = [
    process.env.PYTHON_PATH,
    path.join(venv, 'Scripts', 'python.exe'),
    path.join(venv, 'bin', 'python'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// Dedicated LibreOffice profile so conversions don't clash with a desktop LibreOffice session
const PROFILE_DIR = path.resolve(process.cwd(), 'data', 'libreoffice-profile');
const profileUrl = () => `file:///${PROFILE_DIR.replace(/\\/g, '/').replace(/^\//, '')}`;

// LibreOffice handles one conversion per profile at a time, so conversions are queued
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.stdout.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Conversion took too long and was stopped.'));
    }, CONVERSION_TIMEOUT_MS);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        // The details stay in the server log: they contain file paths users shouldn't see
        console.error(`${path.basename(command)} exited with code ${code}. ${stderr.trim().slice(-500)}`);
        reject(new Error('This file could not be converted. Try again, or try another file.'));
      }
    });
  });
}

async function convertDocument(input: Buffer, inputExt: string, targetExt: string): Promise<Buffer> {
  const soffice = findSoffice();
  const python = findPython();

  const workDir = path.join(os.tmpdir(), `quicksign-convert-${crypto.randomUUID()}`);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    let inputPath = path.join(workDir, `document.${inputExt}`);
    fs.writeFileSync(inputPath, input);

    // PDF -> Word: pdf2docx rebuilds real paragraphs and tables; other targets are made from that Word file
    if (inputExt === 'pdf' && python) {
      const docxPath = path.join(workDir, 'converted.docx');
      await runProcess(python, [PDF_TO_DOCX_SCRIPT, inputPath, docxPath]);
      if (!fs.existsSync(docxPath)) throw new Error('The PDF could not be converted.');
      if (targetExt === 'docx') return fs.readFileSync(docxPath);
      inputPath = docxPath;
      inputExt = 'docx';
    }

    if (!soffice) throw new Error('LibreOffice is not installed on the server.');

    const args = [`-env:UserInstallation=${profileUrl()}`, '--headless', '--norestore', '--nolockcheck', '--nodefault'];
    // Fallback when pdf2docx is unavailable: open PDFs in Writer (instead of Draw) so they can be saved as documents
    if (inputExt === 'pdf') args.push('--infilter=writer_pdf_import');
    args.push('--convert-to', EXPORT_FILTER[targetExt], '--outdir', workDir, inputPath);

    await enqueue(() => runProcess(soffice, args));

    const outputPath = path.join(workDir, `${path.basename(inputPath, path.extname(inputPath))}.${targetExt}`);
    if (!fs.existsSync(outputPath)) throw new Error('LibreOffice did not produce an output file.');
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export function createConvertRouter() {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json({
      available: Boolean(findSoffice()),
      engine: 'LibreOffice',
      pdfToWord: findPython() ? 'pdf2docx' : 'libreoffice',
      targets: TARGETS_BY_FAMILY,
      families: FAMILY_BY_EXT,
    });
  });

  // Body: raw file bytes. Query: name (original file name), to (target extension)
  router.post('/file', express.raw({ type: () => true, limit: MAX_UPLOAD }), async (req, res) => {
    const name = String(req.query.name || 'document');
    const to = String(req.query.to || '').toLowerCase();
    const inputExt = path.extname(name).slice(1).toLowerCase();
    const family = FAMILY_BY_EXT[inputExt];

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }
    if (!family) {
      return res.status(400).json({ error: `Files of type ".${inputExt}" cannot be converted.` });
    }
    if (!TARGETS_BY_FAMILY[family].includes(to)) {
      return res.status(400).json({ error: `A .${inputExt} file cannot be converted to .${to}.` });
    }

    try {
      const output = await convertDocument(req.body, inputExt, to);
      const baseName = path.basename(name, path.extname(name)) || 'document';
      const fileName = `${baseName}.${to}`;
      res.setHeader('Content-Type', MIME[to] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.setHeader('X-Filename', encodeURIComponent(fileName));
      res.send(output);
    } catch (err: any) {
      console.error('Conversion error:', err);
      res.status(500).json({ error: err?.message || 'Conversion failed.' });
    }
  });

  return router;
}
