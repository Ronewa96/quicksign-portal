import React, { useEffect, useRef, useState } from 'react';
import { useDocuments } from '../../context/DocumentContext';
import { DOCUMENT_CATEGORIES } from '../../lib/categories';
import { prepareDocumentUpload, splitTextIntoPages, UPLOAD_ACCEPT } from '../../lib/importDocument';
import { saveOriginalFile } from '../../lib/fileStore';
import {
  Send,
  Upload,
  Plus,
  Trash2,
  PenTool,
  CheckCircle2,
  FileText,
  User,
  Mail,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  LayoutDashboard,
  Sparkles,
} from 'lucide-react';

interface Contact {
  name: string;
  email: string;
  role: string;
}

interface SignerRow {
  name: string;
  email: string;
  role: string;
}

const CATEGORIES: readonly string[] = DOCUMENT_CATEGORIES;

interface AiReview {
  id: string;
  source: 'gemini' | 'fallback';
  model?: string;
  notice?: string;
  truncated: boolean;
  summary: string;
  keyPoints: string[];
  suggestedCategory: string;
  overallRisk: 'low' | 'medium' | 'high';
  risks: Array<{ title: string; level: 'low' | 'medium' | 'high'; clauseSnippet?: string; explanation: string; recommendation: string }>;
  disclaimer: string;
}

const RISK_STYLES = {
  low: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  high: 'bg-rose-500/15 text-rose-300',
};

// Same limits the server enforces, checked here first so mistakes are shown next to the field
const MAX_TITLE = 200;
const MAX_UPLOAD_MB = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEPS = ['Document', 'Signers', 'Review', 'Sent'] as const;
type Step = 0 | 1 | 2 | 3;

interface DocumentErrors {
  title?: string;
  document?: string;
}

interface SignerErrors {
  list?: string;
  rows: Array<{ name?: string; email?: string }>;
}

const isBlankRow = (s: SignerRow) => !s.name.trim() && !s.email.trim();

function validateDocument(title: string, content: string, hasFile: boolean): DocumentErrors {
  const errors: DocumentErrors = {};
  const cleanTitle = title.trim();
  if (!cleanTitle) errors.title = 'Give the document a title.';
  else if (cleanTitle.length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters (it has ${cleanTitle.length}).`;
  if (!hasFile && !content.trim()) errors.document = 'Upload a file or paste the document text.';
  return errors;
}

function validateSigners(signers: SignerRow[]): SignerErrors {
  const rows = signers.map(() => ({} as { name?: string; email?: string }));
  const seen = new Map<string, number>();
  signers.forEach((s, i) => {
    if (isBlankRow(s)) return; // empty rows are ignored
    const email = s.email.trim().toLowerCase();
    if (!s.name.trim()) rows[i].name = "Enter this person's name.";
    if (!email) rows[i].email = 'Enter an email address.';
    else if (!EMAIL_PATTERN.test(email)) rows[i].email = 'Enter a valid email address, like name@company.com.';
    else if (seen.has(email)) rows[i].email = `Signer ${seen.get(email)! + 1} already uses this email.`;
    else seen.set(email, i);
  });
  return {
    rows,
    list: signers.every(isBlankRow) ? 'Add at least one person who needs to sign.' : undefined,
  };
}

const hasDocumentErrors = (e: DocumentErrors) => Boolean(e.title || e.document);
const hasSignerErrors = (e: SignerErrors) => Boolean(e.list || e.rows.some((r) => r.name || r.email));

/** fetch() with plain-language errors for the usual failures (offline, signed out, too large). */
async function request(url: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Can't reach the QuickSign server. Check your internet connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Your session has expired. Sign in again, then send the document.');
  if (res.status === 413) throw new Error(`This document is too large to send. The maximum is ${MAX_UPLOAD_MB} MB.`);
  if (!res.ok) throw new Error(data.error || `Something went wrong on the server (error ${res.status}). Please try again.`);
  return data;
}

const postJson = (url: string, body?: unknown) =>
  request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

const FieldError: React.FC<{ id: string; message?: string }> = ({ id, message }) =>
  message ? (
    <p id={id} className="mt-1 flex items-center gap-1 text-[11px] text-rose-400">
      <AlertCircle className="w-3 h-3 shrink-0" />
      <span>{message}</span>
    </p>
  ) : null;

const inputClass = (invalid: boolean) =>
  `w-full bg-zinc-900 border rounded text-xs text-white focus:outline-none ${
    invalid ? 'border-rose-500/70 focus:border-rose-400' : 'border-zinc-800 focus:border-cyan-500'
  }`;

export const SendDocumentView: React.FC = () => {
  const { addDocument, openDedicatedSigning, userProfile, setActiveView } = useDocuments();

  const defaultSigners = (): SignerRow[] => [
    { name: userProfile.name, email: userProfile.email, role: userProfile.title || 'Sender' },
    { name: '', email: '', role: 'Other party' },
  ];

  const [step, setStep] = useState<Step>(0);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [content, setContent] = useState('');
  const [signers, setSigners] = useState<SignerRow[]>(defaultSigners);
  // 'sequential': each person is emailed only after the person above them has signed
  const [signingOrder, setSigningOrder] = useState<'parallel' | 'sequential'>('parallel');

  // Field errors are shown once the user has tried to continue from that step, then update as they type
  const [attempted, setAttempted] = useState({ document: false, signers: false });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // An uploaded PDF is kept and displayed exactly as-is; its text is only used for search / AI
  const [attachedPdf, setAttachedPdf] = useState<{ file: File; pages: string[] } | null>(null);
  const docErrors = validateDocument(title, content, Boolean(attachedPdf));
  const signerErrors = validateSigners(signers);

  // People this user has sent documents to before, suggested while typing
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/contacts')
      .then((res) => (res.ok ? res.json() : { contacts: [] }))
      .then((data) => setContacts(data.contacts || []))
      .catch(() => setContacts([]));
    fetch('/api/email/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setEmailConfigured(data ? Boolean(data.configured) : null))
      .catch(() => setEmailConfigured(null));
  }, []);

  // Result of emailing a document to its signers
  const [sendResult, setSendResult] = useState<{
    mySignToken?: string;
    signingOrder?: 'parallel' | 'sequential';
    emailConfigured: boolean;
    results: Array<{ to: string; delivered: boolean; error?: string }>;
  } | null>(null);
  const [sentTitle, setSentTitle] = useState('');
  const [sentWithSummary, setSentWithSummary] = useState(false);

  // AI review of the document: runs when leaving step 1, and its result feeds the rest of the workflow
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'done' | 'skipped' | 'error'>('idle');
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [reviewedText, setReviewedText] = useState<string | null>(null);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [shareSummary, setShareSummary] = useState(true);
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const latestReview = useRef(0);

  const runAiReview = async () => {
    const text = content.trim();
    const run = ++latestReview.current;
    setReviewedText(text);
    setAiStatus('running');
    setAiReview(null);
    setAiMessage(null);
    setRiskConfirmed(false);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentTitle: title.trim(), documentText: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (run !== latestReview.current) return; // the document changed while this was running
      if (!res.ok) {
        // 400: the text itself can't be reviewed (e.g. a scanned PDF), which doesn't stop the sending
        setAiStatus(res.status === 400 ? 'skipped' : 'error');
        setAiMessage(data.error || 'The AI review could not be completed.');
        return;
      }
      setAiReview(data);
      setAiStatus('done');
      setCategoryTouched((touched) => {
        if (!touched) setCategory(data.suggestedCategory);
        return touched;
      });
    } catch {
      if (run !== latestReview.current) return;
      setAiStatus('error');
      setAiMessage("Can't reach the QuickSign server to review this document.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    setUploadError(null);
    if (file.size === 0) {
      setUploadError(`"${file.name}" is empty. Choose another file.`);
      input.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The maximum is ${MAX_UPLOAD_MB} MB.`);
      input.value = '';
      return;
    }

    setIsExtracting(true);
    try {
      // PDFs are kept as-is; Word, Excel, etc. are turned into a PDF so they keep their exact look
      const prepared = await prepareDocumentUpload(file);
      if (!title.trim()) setTitle(file.name.replace(/\.[^/.]+$/, '').slice(0, MAX_TITLE));
      setContent(prepared.text);
      setAttachedPdf(prepared.pdfFile ? { file: prepared.pdfFile, pages: prepared.pages } : null);
    } catch (err: any) {
      setUploadError(err?.message || `"${file.name}" could not be read. Try saving it as a PDF and uploading that.`);
    } finally {
      setIsExtracting(false);
      input.value = '';
    }
  };

  const removeAttachedPdf = () => {
    setAttachedPdf(null);
    setContent('');
  };

  const addSignerRow = () => setSigners((prev) => [...prev, { name: '', email: '', role: 'Signer' }]);
  const removeSignerRow = (index: number) => setSigners((prev) => prev.filter((_, i) => i !== index));

  const moveSigner = (index: number, offset: -1 | 1) => {
    setSigners((prev) => {
      const target = index + offset;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const updateSigner = (index: number, field: keyof SignerRow, val: string) => {
    setSigners((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const next = { ...s, [field]: val };
        // Picking a remembered contact by email or name fills in the rest of the row
        const match =
          field === 'email'
            ? contacts.find((c) => c.email === val.trim().toLowerCase())
            : field === 'name'
            ? contacts.find((c) => c.name === val)
            : undefined;
        if (match) {
          next.name = next.name || match.name;
          if (field === 'name') next.name = match.name;
          next.email = match.email;
          next.role = s.role && s.role !== 'Other party' && s.role !== 'Signer' ? s.role : match.role || s.role;
        }
        return next;
      })
    );
  };

  // ---------- Navigation ----------

  const focusFirst = (ids: Array<string | false | undefined>) => {
    const id = ids.find(Boolean);
    if (id) setTimeout(() => document.getElementById(id)?.focus(), 0);
  };

  const goNext = () => {
    if (step === 0) {
      setAttempted((a) => ({ ...a, document: true }));
      if (hasDocumentErrors(docErrors)) {
        focusFirst([docErrors.title && 'send-title', docErrors.document && (attachedPdf ? undefined : 'send-document')]);
        return;
      }
      if (content.trim() !== reviewedText || aiStatus === 'error') runAiReview();
      setStep(1);
    } else if (step === 1) {
      setAttempted((a) => ({ ...a, signers: true }));
      if (hasSignerErrors(signerErrors)) {
        const firstRow = signerErrors.rows.findIndex((r) => r.name || r.email);
        focusFirst([
          firstRow >= 0 && `signer-${firstRow}-${signerErrors.rows[firstRow].name ? 'name' : 'email'}`,
          signerErrors.list && 'signer-0-name',
        ]);
        return;
      }
      setStep(2);
    }
    setSendError(null);
  };

  const goBack = () => {
    setSendError(null);
    setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
  };

  const resetForm = () => {
    setStep(0);
    setSendResult(null);
    setSendError(null);
    setTitle('');
    setCategory(CATEGORIES[0]);
    setCategoryTouched(false);
    latestReview.current += 1;
    setAiStatus('idle');
    setAiReview(null);
    setAiMessage(null);
    setReviewedText(null);
    setShareSummary(true);
    setRiskConfirmed(false);
    setContent('');
    setAttachedPdf(null);
    setSigners(defaultSigners());
    setSigningOrder('parallel');
    setAttempted({ document: false, signers: false });
  };

  // ---------- Submit ----------

  const people = signers
    .filter((s) => !isBlankRow(s))
    .map((s) => ({ name: s.name.trim(), email: s.email.trim().toLowerCase(), role: s.role.trim() }));
  const isSequential = signingOrder === 'sequential' && people.length > 1;
  const includeSummary = shareSummary && aiStatus === 'done' && aiReview !== null;
  // A high-risk result has to be acknowledged before the document can go out
  const needsRiskConfirmation = aiStatus === 'done' && aiReview?.overallRisk === 'high' && !riskConfirmed;

  const preparedPages = () => {
    const raw = attachedPdf ? content.trim() : content.trim() || `${title}\n\n(No document text was provided.)`;
    // One entry per real PDF page so tags line up with the original layout; otherwise split the text
    return { raw, pages: attachedPdf ? attachedPdf.pages : splitTextIntoPages(raw) };
  };

  // Stores the document on the server and emails every signer a private signing link
  const sendForSigning = async () => {
    // Re-check everything in case the user went back and changed something
    if (hasDocumentErrors(docErrors)) return setStep(0);
    if (hasSignerErrors(signerErrors)) return setStep(1);

    const { raw, pages } = preparedPages();
    setIsSubmitting(true);
    setSendError(null);
    try {
      const { id } = await postJson('/api/requests', {
        title: title.trim(),
        category,
        pages,
        rawText: raw,
        signers: people,
        signingOrder: isSequential ? 'sequential' : 'parallel',
        analysisId: includeSummary ? aiReview!.id : undefined,
      });
      if (attachedPdf) {
        await request(`/api/requests/${id}/original`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: attachedPdf.file,
        });
      }
      const result = await postJson(`/api/requests/${id}/send`);
      setSentTitle(title.trim());
      setSentWithSummary(includeSummary);
      setSendResult(result);
      setAttachedPdf(null);
      setStep(3);
    } catch (err: any) {
      setSendError(err?.message || 'The document could not be sent. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const signMyself = async () => {
    if (hasDocumentErrors(docErrors)) return setStep(0);
    const { raw, pages } = preparedPages();
    const validSigners = people.map((s) => ({ ...s, status: 'pending' as const }));

    const newDoc = addDocument({
      title: title.trim(),
      category,
      rawText: raw,
      pages: pages.length > 0 ? pages : [raw],
      fileType: 'pdf',
      originalFile: attachedPdf
        ? { name: attachedPdf.file.name, mimeType: 'application/pdf', size: attachedPdf.file.size }
        : undefined,
      status: 'pending',
      signers: validSigners.length > 0
        ? validSigners
        : [{ name: userProfile.name, email: userProfile.email, role: userProfile.title, status: 'pending' }],
      signatureTags: [
        {
          id: `tag-${Date.now()}`,
          pageIndex: (pages.length || 1) - 1,
          x: 25,
          y: 75,
          type: 'signature',
          signerName: userProfile.name,
          signerEmail: userProfile.email,
          isCompleted: false,
        },
      ],
    });

    if (attachedPdf) {
      setIsSubmitting(true);
      try {
        await saveOriginalFile(newDoc.id, attachedPdf.file);
      } catch (err) {
        console.error('Failed to store original PDF:', err);
        setSendError('The document was created, but its original PDF could not be stored on this device.');
      } finally {
        setIsSubmitting(false);
      }
      setAttachedPdf(null);
    }

    openDedicatedSigning(newDoc.id);
  };

  // ---------- Pieces ----------

  const showDocErrors = attempted.document;
  const showSignerErrors = attempted.signers;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const isMe = (email: string) => email.trim().toLowerCase() === userProfile.email.trim().toLowerCase();

  const stepper = (
    <ol className="flex items-center gap-1 sm:gap-2" aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        // Earlier steps can be revisited until the document has been sent
        const canJump = done && step < 3;
        return (
          <li key={label} className="flex items-center gap-1 sm:gap-2 flex-1 last:flex-none">
            <button
              type="button"
              onClick={() => canJump && setStep(i as Step)}
              disabled={!canJump}
              aria-current={current ? 'step' : undefined}
              className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${canJump ? 'cursor-pointer hover:text-white' : 'cursor-default'} ${
                current ? 'text-white font-semibold' : done ? 'text-cyan-300' : 'text-zinc-500'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono border ${
                  current
                    ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300'
                    : done
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                    : 'border-zinc-700 text-zinc-500'
                }`}
              >
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className={current ? '' : 'hidden sm:inline'}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 ${done ? 'bg-cyan-500/40' : 'bg-zinc-800'}`} />}
          </li>
        );
      })}
    </ol>
  );

  const errorBanner = sendError && (
    <div role="alert" className="flex items-start gap-2 p-3 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{sendError}</span>
    </div>
  );

  const nav = (next: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      {step > 0 ? (
        <button
          type="button"
          onClick={goBack}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 px-4 py-2 text-xs text-zinc-300 hover:text-white rounded cursor-pointer disabled:opacity-40"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-3">{next}</div>
    </div>
  );

  const nextButton = (
    <button
      type="button"
      onClick={goNext}
      disabled={isExtracting}
      className="flex items-center gap-1.5 px-5 py-2 bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-semibold rounded shadow cursor-pointer disabled:opacity-40"
    >
      <span>Continue</span>
      <ArrowRight className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-y-auto">
      {/* Top Header */}
      <div className="px-4 sm:px-8 py-5 sm:py-6 border-b border-zinc-800 bg-zinc-950">
        <div className="max-w-4xl mx-auto space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <Send className="w-5 h-5 text-cyan-400" />
              <h1 className="text-xl font-bold tracking-tight text-white font-display">Send a Document for Signing</h1>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Add the document, choose who needs to sign, check the details, then send. Each person gets a private signing link by email.
            </p>
          </div>
          {stepper}
        </div>
      </div>

      <div className="max-w-4xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {/* ---------- Step 1: Document ---------- */}
        {step === 0 && (
          <>
            <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">01. Document Details</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="send-title" className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Document Title <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="send-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Employment Contract – Jane Smith"
                    aria-invalid={showDocErrors && !!docErrors.title}
                    aria-describedby={showDocErrors && docErrors.title ? 'send-title-error' : undefined}
                    className={`${inputClass(showDocErrors && !!docErrors.title)} px-3 py-2`}
                  />
                  <FieldError id="send-title-error" message={showDocErrors ? docErrors.title : undefined} />
                </div>

                <div>
                  <label htmlFor="send-category" className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Category
                  </label>
                  <select
                    id="send-category"
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setCategoryTouched(true);
                    }}
                    className={`${inputClass(false)} px-3 py-2`}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Upload or paste text */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label htmlFor="send-document" className="block text-xs font-medium text-zinc-400">
                    Document <span className="text-rose-400">*</span>
                  </label>
                  <label
                    className={`flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 ${
                      isExtracting ? 'cursor-wait opacity-60' : 'cursor-pointer'
                    }`}
                  >
                    {isExtracting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    <span>{isExtracting ? 'Reading file…' : `Upload File (PDF, Word, Excel, PowerPoint… up to ${MAX_UPLOAD_MB} MB)`}</span>
                    <input type="file" accept={UPLOAD_ACCEPT} onChange={handleFileUpload} disabled={isExtracting} className="hidden" />
                  </label>
                </div>
                {uploadError && (
                  <div role="alert" className="mb-2 flex items-start gap-2 p-2 rounded border border-rose-500/30 bg-rose-950/20 text-[11px] text-rose-300">
                    <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}
                {attachedPdf ? (
                  <div className="p-3 bg-zinc-900 border border-cyan-500/40 rounded flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-5 h-5 text-cyan-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{attachedPdf.file.name}</div>
                        <div className="text-[11px] text-zinc-400">
                          {attachedPdf.pages.length} page{attachedPdf.pages.length === 1 ? '' : 's'} ·{' '}
                          {(attachedPdf.file.size / 1024).toFixed(0)} KB · original layout will be preserved
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={removeAttachedPdf}
                      className="p-1.5 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                      title="Remove file"
                      aria-label="Remove attached file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <textarea
                      id="send-document"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Paste the document text here, or upload a file..."
                      rows={8}
                      aria-invalid={showDocErrors && !!docErrors.document}
                      aria-describedby={showDocErrors && docErrors.document ? 'send-document-error' : undefined}
                      className={`${inputClass(showDocErrors && !!docErrors.document)} p-3 font-mono text-zinc-300 leading-relaxed`}
                    />
                    <FieldError id="send-document-error" message={showDocErrors ? docErrors.document : undefined} />
                  </>
                )}
              </div>
            </div>
            {nav(nextButton)}
          </>
        )}

        {/* ---------- Step 2: Signers ---------- */}
        {step === 1 && (
          <>
            <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">02. Who Needs to Sign</div>
                <button
                  type="button"
                  onClick={addSignerRow}
                  className="flex items-center gap-1 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Add Signer</span>
                </button>
              </div>

              {signers.length > 1 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-zinc-400">Signing order</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Signing order">
                    {([
                      ['parallel', 'Everyone at once', 'All signers are emailed now and can sign in any order.'],
                      ['sequential', 'One after another', 'Signers sign in the order below. Each person is emailed only after the one above has signed.'],
                    ] as const).map(([value, label, hint]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={signingOrder === value}
                        onClick={() => setSigningOrder(value)}
                        className={`p-3 text-left rounded border transition-colors cursor-pointer ${
                          signingOrder === value ? 'border-cyan-500 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                        }`}
                      >
                        <div className="text-xs font-semibold text-white">{label}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">{hint}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {signers.map((signer, index) => {
                  const rowErrors = showSignerErrors ? signerErrors.rows[index] || {} : {};
                  return (
                    <div key={index} className="p-3 bg-zinc-900/60 border border-zinc-800 rounded flex flex-col md:flex-row md:items-start gap-3">
                      <div className="flex md:flex-col items-center gap-1 shrink-0 md:pt-0.5">
                        {signingOrder === 'sequential' && signers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => moveSigner(index, -1)}
                            disabled={index === 0}
                            className="p-0.5 text-zinc-500 hover:text-white disabled:opacity-20 cursor-pointer disabled:cursor-default"
                            title="Move up"
                            aria-label={`Move signer ${index + 1} up`}
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-mono text-zinc-400">
                          {index + 1}
                        </div>
                        {signingOrder === 'sequential' && signers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => moveSigner(index, 1)}
                            disabled={index === signers.length - 1}
                            className="p-0.5 text-zinc-500 hover:text-white disabled:opacity-20 cursor-pointer disabled:cursor-default"
                            title="Move down"
                            aria-label={`Move signer ${index + 1} down`}
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div>
                          <div className="relative">
                            <User className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input
                              id={`signer-${index}-name`}
                              type="text"
                              value={signer.name}
                              onChange={(e) => updateSigner(index, 'name', e.target.value)}
                              list="contact-names"
                              autoComplete="off"
                              placeholder="Signer Full Name"
                              aria-label={`Signer ${index + 1} name`}
                              aria-invalid={!!rowErrors.name}
                              className={`${inputClass(!!rowErrors.name)} bg-zinc-950 pl-8 pr-2.5 py-1.5`}
                            />
                          </div>
                          <FieldError id={`signer-${index}-name-error`} message={rowErrors.name} />
                        </div>

                        <div>
                          <div className="relative">
                            <Mail className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input
                              id={`signer-${index}-email`}
                              type="email"
                              value={signer.email}
                              onChange={(e) => updateSigner(index, 'email', e.target.value)}
                              list="contact-emails"
                              autoComplete="off"
                              placeholder="name@company.com"
                              aria-label={`Signer ${index + 1} email`}
                              aria-invalid={!!rowErrors.email}
                              className={`${inputClass(!!rowErrors.email)} bg-zinc-950 pl-8 pr-2.5 py-1.5`}
                            />
                          </div>
                          <FieldError id={`signer-${index}-email-error`} message={rowErrors.email} />
                        </div>

                        <input
                          type="text"
                          value={signer.role}
                          onChange={(e) => updateSigner(index, 'role', e.target.value)}
                          placeholder="Role (optional)"
                          aria-label={`Signer ${index + 1} role`}
                          className={`${inputClass(false)} bg-zinc-950 px-2.5 py-1.5 self-start`}
                        />
                      </div>

                      {signers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSignerRow(index)}
                          className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer self-end md:self-start"
                          title="Remove signer"
                          aria-label={`Remove signer ${index + 1}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <FieldError id="signers-error" message={showSignerErrors ? signerErrors.list : undefined} />
              <p className="text-[11px] text-zinc-500">Empty rows are ignored. People you've sent to before are suggested as you type.</p>
            </div>

            {/* Remembered contacts for the signer fields */}
            <datalist id="contact-emails">
              {contacts.map((c) => (
                <option key={c.email} value={c.email}>
                  {c.name}
                </option>
              ))}
            </datalist>
            <datalist id="contact-names">
              {contacts.map((c) => (
                <option key={c.email} value={c.name}>
                  {c.email}
                </option>
              ))}
            </datalist>

            {nav(nextButton)}
          </>
        )}

        {/* ---------- Step 3: Review ---------- */}
        {step === 2 && (
          <>
            <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-cyan-400">03. Check and Send</div>

              <dl className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-x-4 gap-y-3 text-xs">
                <dt className="text-zinc-500">Title</dt>
                <dd className="text-white font-semibold wrap-break-word">{title.trim()}</dd>
                <dt className="text-zinc-500">Category</dt>
                <dd className="text-zinc-200">{category}</dd>
                <dt className="text-zinc-500">Document</dt>
                <dd className="text-zinc-200 flex items-center gap-1.5 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">
                    {attachedPdf
                      ? `${attachedPdf.file.name} · ${attachedPdf.pages.length} page${attachedPdf.pages.length === 1 ? '' : 's'}`
                      : `Pasted text · ${wordCount} word${wordCount === 1 ? '' : 's'}`}
                  </span>
                </dd>
                <dt className="text-zinc-500">Signing order</dt>
                <dd className="text-zinc-200">
                  {isSequential ? 'One after another, in the order below' : people.length > 1 ? 'Everyone at once' : 'One signer'}
                </dd>
              </dl>

              <div className="space-y-2">
                <div className="text-xs text-zinc-500">
                  {people.length} signer{people.length === 1 ? '' : 's'}
                </div>
                <ol className="space-y-1.5">
                  {people.map((p, i) => (
                    <li key={p.email} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 rounded bg-zinc-900/60 border border-zinc-800 text-xs">
                      <span className="font-mono text-zinc-500">{i + 1}.</span>
                      <span className="text-white">{p.name}</span>
                      <span className="text-zinc-400">{p.email}</span>
                      {p.role && <span className="text-zinc-500">· {p.role}</span>}
                      {isMe(p.email) && <span className="text-[10px] uppercase font-semibold text-cyan-300">You</span>}
                      <span className="ml-auto text-[11px] text-zinc-500">
                        {isSequential && i > 0 ? `Emailed after ${people[i - 1].name} signs` : isMe(p.email) ? 'Signs from the next screen' : 'Emailed now'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <p className="text-xs text-zinc-400">
                When everyone has signed, all signers and you receive the signed PDF by email. You can follow progress on the Dashboard.
              </p>

              {emailConfigured === false && (
                <div className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                  <span>
                    Email isn't connected yet, so the emails will be saved to the server's outbox folder instead of being delivered.
                    You can still send to test the process.
                  </span>
                </div>
              )}
            </div>

            {/* AI review: the result sets the category, goes to the signers, and can require a confirmation */}
            <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 rounded-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-cyan-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>04. AI Review</span>
                </div>
                {aiReview && (
                  <span className="text-[11px] text-zinc-500">
                    {aiReview.source === 'gemini' ? `Google Gemini (${aiReview.model})` : 'Basic keyword check, no AI'}
                  </span>
                )}
              </div>

              {aiStatus === 'running' && (
                <p role="status" className="flex items-center gap-2 text-xs text-zinc-300">
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                  <span>Reviewing the document. Sending is available when this finishes.</span>
                </p>
              )}

              {(aiStatus === 'skipped' || aiStatus === 'error') && (
                <div className="flex flex-wrap items-start justify-between gap-3 p-3 rounded border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200">
                  <span className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                    <span>{aiMessage} You can still send the document, without a summary.</span>
                  </span>
                  {aiStatus === 'error' && (
                    <button type="button" onClick={runAiReview} className="text-cyan-300 hover:text-cyan-200 underline cursor-pointer">
                      Try again
                    </button>
                  )}
                </div>
              )}

              {aiReview && (
                <>
                  {aiReview.notice && (
                    <div className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-950/20 text-xs text-amber-200">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                      <span>{aiReview.notice}</span>
                    </div>
                  )}

                  <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">{aiReview.summary}</p>

                  {aiReview.keyPoints.length > 0 && (
                    <ul className="list-disc pl-4 space-y-1 text-xs text-zinc-400">
                      {aiReview.keyPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-zinc-500">Category:</span>
                    <span className="text-zinc-200">{category}</span>
                    {category === aiReview.suggestedCategory ? (
                      <span className="text-[11px] text-cyan-300">{categoryTouched ? 'Matches the suggestion' : 'Set from the review'}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCategory(aiReview.suggestedCategory)}
                        className="text-[11px] text-cyan-300 hover:text-cyan-200 underline cursor-pointer"
                      >
                        Use suggestion: {aiReview.suggestedCategory}
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>Overall risk:</span>
                      <span className={`text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded ${RISK_STYLES[aiReview.overallRisk]}`}>
                        {aiReview.overallRisk}
                      </span>
                    </div>
                    {aiReview.risks.map((risk) => (
                      <div key={risk.title} className="p-3 rounded bg-zinc-900/60 border border-zinc-800 text-xs space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded ${RISK_STYLES[risk.level]}`}>{risk.level}</span>
                          <span className="font-semibold text-white">{risk.title}</span>
                        </div>
                        {risk.clauseSnippet && <p className="italic text-zinc-500">"{risk.clauseSnippet}"</p>}
                        <p className="text-zinc-300">{risk.explanation}</p>
                        <p className="text-zinc-400">Suggestion: {risk.recommendation}</p>
                      </div>
                    ))}
                  </div>

                  <label className="flex items-start gap-2 text-xs text-zinc-200 cursor-pointer">
                    <input type="checkbox" checked={shareSummary} onChange={(e) => setShareSummary(e.target.checked)} className="mt-0.5" />
                    <span>Include the summary and key points in the signing email and on the signing page</span>
                  </label>

                  {aiReview.overallRisk === 'high' && (
                    <label className="flex items-start gap-2 p-3 rounded border border-rose-500/30 bg-rose-950/20 text-xs text-rose-200 cursor-pointer">
                      <input type="checkbox" checked={riskConfirmed} onChange={(e) => setRiskConfirmed(e.target.checked)} className="mt-0.5" />
                      <span>I have read the high-risk items above and still want to send this document.</span>
                    </label>
                  )}

                  <p className="text-[11px] text-zinc-500">{aiReview.disclaimer}</p>
                </>
              )}
            </div>

            {errorBanner}

            {nav(
              <>
                <button
                  type="button"
                  onClick={signMyself}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 rounded cursor-pointer disabled:opacity-40"
                  title="Open the document and sign it yourself, without emailing anyone"
                >
                  <PenTool className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Sign It Myself Instead</span>
                </button>
                <button
                  type="button"
                  onClick={sendForSigning}
                  disabled={isSubmitting || aiStatus === 'running' || needsRiskConfirmation}
                  title={needsRiskConfirmation ? 'Confirm the high-risk items above first' : undefined}
                  className="flex items-center gap-1.5 px-5 py-2 bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-semibold rounded shadow cursor-pointer disabled:opacity-40"
                >
                  {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>{isSubmitting ? 'Sending…' : `Send to ${people.length} Signer${people.length === 1 ? '' : 's'}`}</span>
                </button>
              </>
            )}
          </>
        )}

        {/* ---------- Step 4: Sent ---------- */}
        {step === 3 && (
          <div className="p-5 sm:p-8 bg-zinc-950 border border-zinc-800 rounded-lg text-center space-y-4" role="status">
            <div className="w-12 h-12 rounded-full bg-cyan-500/10 text-cyan-400 mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white font-display wrap-break-word">"{sentTitle}" was sent for signing</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              {sendResult?.signingOrder === 'sequential'
                ? 'The first signer has been emailed a private link to sign. Each next person is emailed automatically once the person before them has signed.'
                : 'Each signer has been emailed a private link to sign.'}{' '}
              You'll get an email as people sign or decline, and everyone receives the fully signed PDF when the last person signs.
              {sentWithSummary && ' The summary from the review was included for the signers.'}
            </p>

            {sendResult && (
              <div className="max-w-md mx-auto text-left text-xs space-y-1.5">
                <div className="text-zinc-500">Emails</div>
                {sendResult.results.map((r, i) => (
                  <div key={`${r.to}-${i}`} className="flex items-center gap-2">
                    {r.delivered ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                    <span className="text-zinc-300 truncate">{r.to}</span>
                    {!r.delivered && <span className="text-rose-300 truncate">— {r.error || 'not sent'}</span>}
                  </div>
                ))}
                {!sendResult.emailConfigured && (
                  <p className="pt-2 text-amber-300">
                    Email isn't connected yet, so these emails were saved to the server's outbox folder instead of being delivered.
                  </p>
                )}
              </div>
            )}

            <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
              {sendResult?.mySignToken && (
                <a
                  href={`/sign/${sendResult.mySignToken}`}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white text-zinc-950 font-semibold text-xs rounded shadow cursor-pointer hover:bg-zinc-200"
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span>Sign Your Part Now</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setActiveView('dashboard')}
                className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 rounded cursor-pointer hover:text-white"
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-cyan-400" />
                <span>Track Progress on Dashboard</span>
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 text-xs text-zinc-400 rounded cursor-pointer hover:text-white"
              >
                Send Another Document
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
