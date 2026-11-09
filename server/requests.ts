import express, { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AuthedRequest } from './auth';
import { sendMail, emailLayout, isEmailConfigured, publicAppUrl, MailResult } from './mailer';
import { analysisForDocument } from './ai';
import {
  AiSummary,
  Signer,
  SignRequest,
  Tag,
  contactsOf,
  deleteContact,
  deleteRequestRecord,
  findRequestById,
  findRequestBySignerToken,
  rememberContactRecords,
  requestsSentBy,
  saveRequestRecord,
} from './db';

// Documents sent to other people for signing, available to every signer through a private link
// (no account needed). Records are in the database; the PDFs themselves are files in data/requests.

const DATA_DIR = path.resolve(process.cwd(), 'data');
const REQUESTS_DIR = path.join(DATA_DIR, 'requests');
const MAX_PDF = '50mb';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Storage ----------

const originalFile = (id: string) => path.join(REQUESTS_DIR, `${id}.original.pdf`);
const signedFile = (id: string) => path.join(REQUESTS_DIR, `${id}.signed.pdf`);
const isSafeId = (id: string) => /^req-[a-z0-9-]+$/.test(id);

const loadRequest = (id: string) => (isSafeId(id) ? findRequestById(id) : null);

function saveRequest(request: SignRequest) {
  fs.mkdirSync(REQUESTS_DIR, { recursive: true });
  request.updatedAt = new Date().toISOString();
  saveRequestRecord(request);
}

const findByToken = (token: string) => (/^[a-f0-9]{48}$/.test(token) ? findRequestBySignerToken(token) : null);

/** Remembers everyone a user sends documents to, except themselves. */
function rememberContacts(userId: string, people: Array<{ name: string; email: string; role: string }>, ownEmail: string) {
  // Copy only these fields: signer records also hold private signing tokens
  const others = people.filter((p) => p.email !== ownEmail).map(({ name, email, role }) => ({ name, email, role }));
  rememberContactRecords(userId, others, new Date().toISOString());
}

// ---------- Helpers ----------

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

function audit(request: SignRequest, req: Request, action: string, actor: string, details: string) {
  request.auditTrail.push({
    id: newId('aud'),
    timestamp: new Date().toISOString(),
    action,
    actor,
    details,
    ipAddress: req.ip || 'unknown',
    deviceInfo: String(req.headers['user-agent'] || 'unknown').slice(0, 200),
  });
}

const signUrl = (req: Request, token: string) => `${publicAppUrl(req)}/sign/${token}`;

const isSequential = (request: SignRequest) => request.signingOrder === 'sequential';

/** The signer whose turn it is in a sequential request (the first one who hasn't signed). */
const currentSigner = (request: SignRequest) => request.signers.find((s) => s.status === 'pending');

/** Whether this signer may sign now: always in parallel mode, only on their turn in sequential mode. */
const isTurn = (request: SignRequest, signer: Signer) =>
  request.status === 'pending' && signer.status === 'pending' && (!isSequential(request) || currentSigner(request) === signer);

const MAX_DECLINE_REASON = 1000;

/** What the sender sees: never other signers' private tokens. */
function senderView(request: SignRequest) {
  const mine = request.signers.find((s) => s.email === request.sender.email);
  const current = isSequential(request) && request.status === 'pending' ? currentSigner(request) : undefined;
  return {
    ...request,
    signingOrder: request.signingOrder || 'parallel',
    currentSignerId: current?.id,
    signers: request.signers.map(({ token, ...rest }) => rest),
    tags: request.tags.map(({ signatureDataUrl, ...rest }) => rest),
    mySignToken: mine && isTurn(request, mine) ? mine.token : undefined,
  };
}

/** What a signer sees through their link. */
function signerView(request: SignRequest, signer: Signer) {
  return {
    id: request.id,
    title: request.title,
    pages: request.pages,
    rawText: request.rawText,
    hasOriginal: request.hasOriginal,
    status: request.status,
    transactionId: request.transactionId,
    completedAt: request.completedAt,
    declinedAt: request.declinedAt,
    hasSignedPdf: request.hasSignedPdf,
    sender: { name: request.sender.name, email: request.sender.email },
    me: { id: signer.id, name: signer.name, email: signer.email, role: signer.role, status: signer.status },
    signingOrder: request.signingOrder || 'parallel',
    myTurn: isTurn(request, signer),
    waitingFor:
      request.status === 'pending' && !isTurn(request, signer) && signer.status === 'pending' ? currentSigner(request)?.name : undefined,
    signers: request.signers.map((s) => ({
      name: s.name,
      email: s.email,
      role: s.role,
      status: s.status,
      signedAt: s.signedAt,
      declineReason: s.declineReason,
    })),
    aiSummary: request.aiSummary
      ? {
          source: request.aiSummary.source,
          summary: request.aiSummary.summary,
          keyPoints: request.aiSummary.keyPoints,
          disclaimer: request.aiSummary.disclaimer,
        }
      : undefined,
    tags: request.tags,
  };
}

/**
 * Emails the next signer in a sequential request once it is their turn. When the next signer is
 * the sender, they get a "your turn" email with their signing button instead.
 */
async function notifyNextSigner(req: Request, request: SignRequest): Promise<MailResult | null> {
  const next = currentSigner(request);
  if (!next) return null;
  if (next.email !== request.sender.email) {
    audit(request, req, 'Sent to next signer', 'QuickSign', `Signing request emailed to ${next.name} (${next.email}).`);
    return sendSignRequestEmail(req, request, next);
  }
  const mail = emailLayout({
    heading: `It's your turn to sign "${request.title}"`,
    paragraphs: [
      `Hi ${request.sender.name},`,
      `Everyone before you has signed "${request.title}". It's now your turn.`,
    ],
    button: { label: 'Sign your part', url: signUrl(req, next.token) },
  });
  return sendMail({ to: next.email, subject: `Your turn to sign: ${request.title}`, ...mail });
}

const deliverySummary = (results: MailResult[]) => ({
  results,
  emailConfigured: isEmailConfigured(),
});

async function sendSignRequestEmail(req: Request, request: SignRequest, signer: Signer, isReminder = false) {
  const { html, text } = emailLayout({
    heading: isReminder ? `Reminder: please sign "${request.title}"` : `Please sign "${request.title}"`,
    paragraphs: [
      `Hi ${signer.name},`,
      `${request.sender.name} (${request.sender.email}) has sent you "${request.title}" to sign${signer.role ? ` as ${signer.role}` : ''}.`,
      ...(request.aiSummary
        ? [
            `${request.aiSummary.source === 'gemini' ? 'AI summary' : 'Quick summary'} (for information only, not legal advice): ${request.aiSummary.summary}`,
            ...request.aiSummary.keyPoints.slice(0, 5).map((p) => `• ${p}`),
          ]
        : []),
      'Open the document, place your signature, and click Finish. It only takes a minute and you do not need an account.',
    ],
    button: { label: 'Review and sign', url: signUrl(req, signer.token) },
    footnote: 'This link is personal to you. Do not forward this email.',
  });
  return sendMail({ to: signer.email, subject: `${isReminder ? 'Reminder: ' : ''}Please sign: ${request.title}`, html, text });
}

// ---------- Routes for signed-in users ----------

export function createRequestsRouter() {
  const router = express.Router();

  router.get('/', (req: AuthedRequest, res) => {
    const mine = requestsSentBy(req.user!.id).map(senderView);
    res.json({ requests: mine, emailConfigured: isEmailConfigured() });
  });

  // Step 1: create the request (document text + signers)
  router.post('/', (req: AuthedRequest, res) => {
    const { title, category = 'Other', pages = [], rawText = '', signers = [], signingOrder, analysisId } = req.body || {};
    const cleanSigners = (Array.isArray(signers) ? signers : [])
      .map((s: any) => ({
        name: String(s?.name || '').trim(),
        email: String(s?.email || '').trim().toLowerCase(),
        role: String(s?.role || '').trim(),
      }))
      .filter((s) => s.name || s.email);

    if (!String(title || '').trim()) return res.status(400).json({ error: 'A document title is required.' });
    if (cleanSigners.length === 0) return res.status(400).json({ error: 'Add at least one signer.' });
    const invalid = cleanSigners.find((s) => !s.name || !EMAIL_PATTERN.test(s.email));
    if (invalid) {
      return res.status(400).json({ error: `Each signer needs a name and a valid email address (check "${invalid.name || invalid.email}").` });
    }
    const emails = cleanSigners.map((s) => s.email);
    if (new Set(emails).size !== emails.length) return res.status(400).json({ error: 'Each signer must have a different email address.' });

    // An AI summary can only be attached if this user produced it from this exact document text
    let aiSummary: AiSummary | undefined;
    if (analysisId) {
      const analysis = analysisForDocument(analysisId, req.user!.id, String(rawText));
      if (!analysis) {
        return res.status(400).json({ error: 'The AI summary does not match this document. Go back to the Review step to run it again.' });
      }
      aiSummary = {
        analysisId: analysis.id,
        source: analysis.source,
        model: analysis.model,
        summary: analysis.summary,
        keyPoints: analysis.keyPoints,
        overallRisk: analysis.overallRisk,
        disclaimer: analysis.disclaimer,
      };
    }

    const now = new Date().toISOString();
    const request: SignRequest = {
      id: newId('req'),
      title: String(title).trim().slice(0, 200),
      category: String(category).slice(0, 100),
      createdAt: now,
      updatedAt: now,
      sender: { userId: req.user!.id, name: req.user!.name, email: req.user!.email },
      pages: (Array.isArray(pages) ? pages : []).map((p: any) => String(p)),
      rawText: String(rawText),
      hasOriginal: false,
      signingOrder: signingOrder === 'sequential' && cleanSigners.length > 1 ? 'sequential' : 'parallel',
      signers: cleanSigners.map((s) => ({ ...s, id: newId('sgn'), token: crypto.randomBytes(24).toString('hex'), status: 'pending' as const })),
      tags: [],
      auditTrail: [],
      status: 'draft',
      hasSignedPdf: false,
      aiSummary,
    };
    audit(
      request,
      req,
      'Document created',
      `${req.user!.name} (${req.user!.email})`,
      `Prepared for ${cleanSigners.length} signer(s)${isSequential(request) ? `, signing in order: ${cleanSigners.map((s) => s.name).join(' → ')}` : ''}.`
    );
    if (aiSummary) {
      audit(
        request,
        req,
        'AI summary attached',
        `${req.user!.name} (${req.user!.email})`,
        `${aiSummary.source === 'gemini' ? `Google Gemini (${aiSummary.model})` : 'Basic keyword check (AI unavailable)'}; overall risk ${aiSummary.overallRisk}. Analysis ${aiSummary.analysisId}.`
      );
    }
    saveRequest(request);
    res.status(201).json({ id: request.id });
  });

  // Step 2 (optional): attach the original PDF so signers see the exact layout
  router.put('/:id/original', express.raw({ type: () => true, limit: MAX_PDF }), (req: AuthedRequest, res) => {
    const request = loadRequest(req.params.id);
    if (!request || request.sender.userId !== req.user!.id) return res.status(404).json({ error: 'Document not found.' });
    if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ error: 'The original must be a PDF file.' });
    }
    fs.writeFileSync(originalFile(request.id), req.body);
    request.hasOriginal = true;
    saveRequest(request);
    res.json({ success: true });
  });

  // Step 3: email everyone
  router.post('/:id/send', async (req: AuthedRequest, res, next) => {
    try {
      const request = loadRequest(req.params.id);
      if (!request || request.sender.userId !== req.user!.id) return res.status(404).json({ error: 'Document not found.' });
      if (request.status !== 'draft') return res.status(400).json({ error: 'This document has already been sent.' });

      request.status = 'pending';
      request.sentAt = new Date().toISOString();
      const senderSigner = request.signers.find((s) => s.email === request.sender.email);
      const sequential = isSequential(request);
      // In order: only the first signer is emailed now; the rest are emailed as their turn comes
      const emailNow = request.signers.filter((s) => s !== senderSigner && isTurn(request, s));
      const senderCanSignNow = !!senderSigner && isTurn(request, senderSigner);

      const results: MailResult[] = [];
      for (const signer of emailNow) results.push(await sendSignRequestEmail(req, request, signer));

      // Confirmation to the sender (with their own signing button if they can sign now)
      const names = request.signers.map((s) => `${s.name} (${s.email})`).join(', ');
      const order = request.signers.map((s, i) => `${i + 1}. ${s.name}`).join(', ');
      const confirmation = emailLayout({
        heading: `You sent "${request.title}" for signing`,
        paragraphs: [
          `Hi ${request.sender.name},`,
          sequential
            ? `"${request.title}" will be signed in this order: ${order}. Each person is emailed when it's their turn.`
            : `"${request.title}" has been sent to: ${names}.`,
          senderCanSignNow
            ? 'You are also one of the signers. Use the button below to sign your part.'
            : senderSigner
            ? "You are also one of the signers. We will email you when it's your turn."
            : 'We will email you as people sign.',
          'When everyone has signed, you and every signer will receive the fully signed document by email.',
        ],
        button: senderCanSignNow ? { label: 'Sign your part', url: signUrl(req, senderSigner!.token) } : undefined,
      });
      results.push(await sendMail({ to: request.sender.email, subject: `Sent for signing: ${request.title}`, ...confirmation }));

      audit(
        request,
        req,
        'Sent for signing',
        `${request.sender.name} (${request.sender.email})`,
        sequential
          ? `Signing in order: ${order}. First request emailed to ${emailNow.map((s) => `${s.name} (${s.email})`).join(', ') || request.sender.name}.`
          : `Signing requests emailed to ${names}.`
      );
      saveRequest(request);
      rememberContacts(req.user!.id, request.signers, request.sender.email);

      res.json({ ...deliverySummary(results), signingOrder: request.signingOrder, mySignToken: senderCanSignNow ? senderSigner!.token : undefined });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/remind/:signerId', async (req: AuthedRequest, res, next) => {
    try {
      const request = loadRequest(req.params.id);
      if (!request || request.sender.userId !== req.user!.id) return res.status(404).json({ error: 'Document not found.' });
      if (request.status === 'declined') return res.status(400).json({ error: 'This document was declined, so it can no longer be signed.' });
      const signer = request.signers.find((s) => s.id === req.params.signerId);
      if (!signer || signer.status !== 'pending') return res.status(400).json({ error: 'This person has already signed.' });
      if (!isTurn(request, signer)) {
        return res.status(400).json({ error: `It isn't ${signer.name}'s turn yet. They will be emailed automatically when it is.` });
      }
      const result = await sendSignRequestEmail(req, request, signer, true);
      audit(request, req, 'Reminder sent', request.sender.name, `Reminder emailed to ${signer.name} (${signer.email}).`);
      saveRequest(request);
      res.json(deliverySummary([result]));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/signed.pdf', (req: AuthedRequest, res) => {
    const request = loadRequest(req.params.id);
    if (!request || request.sender.userId !== req.user!.id || !request.hasSignedPdf) return res.status(404).json({ error: 'Signed copy not available.' });
    res.download(signedFile(request.id), `${request.title.replace(/[^a-zA-Z0-9-_ ]/g, '_')} (signed).pdf`);
  });

  router.delete('/:id', (req: AuthedRequest, res) => {
    const request = loadRequest(req.params.id);
    if (!request || request.sender.userId !== req.user!.id) return res.status(404).json({ error: 'Document not found.' });
    deleteRequestRecord(request.id);
    for (const f of [originalFile(request.id), signedFile(request.id)]) fs.rmSync(f, { force: true });
    res.json({ success: true });
  });

  return router;
}

export function createContactsRouter() {
  const router = express.Router();

  router.get('/', (req: AuthedRequest, res) => {
    res.json({ contacts: contactsOf(req.user!.id) });
  });

  router.delete('/:email', (req: AuthedRequest, res) => {
    deleteContact(req.user!.id, String(req.params.email).toLowerCase());
    res.json({ success: true });
  });

  return router;
}

// ---------- Public routes for signers (authorised by their private link token) ----------

export function createPublicSignRouter() {
  const router = express.Router();

  const withSigner = (handler: (req: Request, res: Response, request: SignRequest, signer: Signer) => unknown) =>
    (req: Request, res: Response) => {
      const found = findByToken(String(req.params.token));
      if (!found || found.request.status === 'draft') {
        return res.status(404).json({ error: 'This signing link is not valid. Ask the sender for a new one.' });
      }
      return Promise.resolve(handler(req, res, found.request, found.signer)).catch((err) => {
        console.error('Signing error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' });
      });
    };

  router.get('/:token', withSigner((req, res, request, signer) => {
    if (!signer.viewedAt) {
      signer.viewedAt = new Date().toISOString();
      audit(request, req, 'Opened by signer', `${signer.name} (${signer.email})`, 'Opened the signing link.');
      saveRequest(request);
    }
    res.json(signerView(request, signer));
  }));

  router.get('/:token/original', withSigner((_req, res, request) => {
    if (!request.hasOriginal) return res.status(404).json({ error: 'No original file.' });
    res.type('application/pdf').sendFile(originalFile(request.id));
  }));

  router.get('/:token/signed.pdf', withSigner((_req, res, request) => {
    if (!request.hasSignedPdf) return res.status(404).json({ error: 'The signed copy is not ready yet.' });
    res.download(signedFile(request.id), `${request.title.replace(/[^a-zA-Z0-9-_ ]/g, '_')} (signed).pdf`);
  }));

  // Signer submits the signature / date boxes they placed
  router.post('/:token', withSigner(async (req, res, request, signer) => {
    if (request.status === 'completed' || signer.status === 'signed') {
      return res.status(400).json({ error: 'You have already signed this document.' });
    }
    if (request.status === 'declined') {
      return res.status(400).json({ error: 'This document was declined, so it can no longer be signed.' });
    }
    if (!isTurn(request, signer)) {
      return res.status(400).json({ error: `It isn't your turn yet. ${currentSigner(request)?.name || 'Someone else'} needs to sign first.` });
    }
    const incoming: any[] = Array.isArray(req.body?.tags) ? req.body.tags : [];
    const now = new Date().toISOString();
    const tags: Tag[] = incoming
      .filter((t) => ['signature', 'date', 'nameTag', 'initials'].includes(t?.type))
      .map((t) => ({
        id: newId('tag'),
        pageIndex: Math.max(0, Math.min(request.pages.length - 1, Number(t.pageIndex) || 0)),
        x: Math.max(0, Math.min(100, Number(t.x) || 0)),
        y: Math.max(0, Math.min(100, Number(t.y) || 0)),
        type: t.type,
        signerName: signer.name,
        signerEmail: signer.email,
        isCompleted: true,
        completedAt: now,
        scale: Math.max(0.5, Math.min(5, Number(t.scale) || 1)),
        signatureDataUrl:
          t.type === 'signature' && typeof t.signatureDataUrl === 'string' && t.signatureDataUrl.startsWith('data:image/')
            ? t.signatureDataUrl.slice(0, 500_000)
            : undefined,
      }));

    if (!tags.some((t) => t.type === 'signature' && t.signatureDataUrl)) {
      return res.status(400).json({ error: 'Place your signature on the document before finishing.' });
    }

    request.tags.push(...tags);
    signer.status = 'signed';
    signer.signedAt = now;
    audit(request, req, 'Signed', `${signer.name} (${signer.email})`, `Signed with ${tags.length} item(s) placed on the document.`);

    const signedCount = request.signers.filter((s) => s.status === 'signed').length;
    const allSigned = signedCount === request.signers.length;
    if (allSigned) {
      request.status = 'completed';
      request.completedAt = now;
      request.transactionId = `QS-TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${new Date().getFullYear()}`;
      audit(request, req, 'Completed', 'QuickSign', `All ${request.signers.length} signer(s) have signed. Transaction ID ${request.transactionId}.`);
    }

    // Pass the document on to the next person in line
    const next = !allSigned && isSequential(request) ? currentSigner(request) : undefined;
    if (next) await notifyNextSigner(req, request);
    saveRequest(request);

    // Let the sender know (unless they just signed it themselves)
    if (signer.email !== request.sender.email) {
      const progress = emailLayout({
        heading: `${signer.name} signed "${request.title}"`,
        paragraphs: [
          `Hi ${request.sender.name},`,
          `${signer.name} (${signer.email}) signed "${request.title}".`,
          allSigned
            ? 'Everyone has now signed. The fully signed document will arrive in a separate email.'
            : `${signedCount} of ${request.signers.length} signers have signed so far.`,
          ...(next ? [next.email === request.sender.email
            ? "It's now your turn to sign. We've emailed you a link."
            : `It has now been sent to ${next.name} (${next.email}), who is next to sign.`] : []),
        ],
      });
      await sendMail({ to: request.sender.email, subject: `${signer.name} signed: ${request.title}`, ...progress });
    }

    res.json(signerView(request, signer));
  }));

  // Signer refuses to sign (with an optional note). This stops the request and everyone involved is told.
  router.post('/:token/decline', withSigner(async (req, res, request, signer) => {
    if (signer.status === 'signed') return res.status(400).json({ error: 'You have already signed this document.' });
    if (request.status !== 'pending') {
      return res.status(400).json({ error: request.status === 'declined' ? 'This document has already been declined.' : 'This document is already complete.' });
    }
    if (!isTurn(request, signer)) {
      return res.status(400).json({ error: `It isn't your turn yet. ${currentSigner(request)?.name || 'Someone else'} needs to sign first.` });
    }

    const reason = String(req.body?.reason || '').trim().slice(0, MAX_DECLINE_REASON);
    const now = new Date().toISOString();
    signer.status = 'declined';
    signer.declinedAt = now;
    signer.declineReason = reason || undefined;
    request.status = 'declined';
    request.declinedAt = now;
    audit(request, req, 'Declined', `${signer.name} (${signer.email})`, reason ? `Declined to sign. Reason: ${reason}` : 'Declined to sign. No reason given.');
    saveRequest(request);

    const reasonLine = reason ? `Their reason: "${reason}"` : 'They did not give a reason.';
    const results: MailResult[] = [];

    // The sender
    if (signer.email !== request.sender.email) {
      const mail = emailLayout({
        heading: `${signer.name} declined to sign "${request.title}"`,
        paragraphs: [
          `Hi ${request.sender.name},`,
          `${signer.name} (${signer.email}) has declined to sign "${request.title}".`,
          reasonLine,
          'The document has been stopped and nobody else can sign it. If you want to try again, make any changes needed and send it as a new document.',
        ],
      });
      results.push(await sendMail({ to: request.sender.email, subject: `Declined: ${request.title}`, ...mail }));
    }

    // Other signers who already received the document (in order: only those before this signer)
    const informed = request.signers.filter(
      (s) => s !== signer && s.email !== request.sender.email && (s.status === 'signed' || !isSequential(request))
    );
    for (const person of informed) {
      const mail = emailLayout({
        heading: `"${request.title}" will not be completed`,
        paragraphs: [
          `Hi ${person.name},`,
          `${signer.name} has declined to sign "${request.title}", which ${request.sender.name} sent for signing.`,
          reasonLine,
          `The document has been stopped${person.status === 'signed' ? ', so your signature will not be used' : ' and no longer needs your signature'}. Contact ${request.sender.name} (${request.sender.email}) if you have questions.`,
        ],
      });
      results.push(await sendMail({ to: person.email, subject: `Declined: ${request.title}`, ...mail }));
    }

    // A copy for the person who declined
    const confirmation = emailLayout({
      heading: `You declined to sign "${request.title}"`,
      paragraphs: [
        `Hi ${signer.name},`,
        `You declined to sign "${request.title}"${signer.email === request.sender.email ? '' : ` from ${request.sender.name}`}.`,
        reason ? `Your reason: "${reason}"` : 'You did not give a reason.',
        signer.email === request.sender.email
          ? 'The document has been stopped and nobody else can sign it.'
          : `${request.sender.name} has been told. Nothing else is needed from you.`,
      ],
    });
    results.push(await sendMail({ to: signer.email, subject: `You declined: ${request.title}`, ...confirmation }));

    audit(
      request,
      req,
      'Decline emailed',
      'QuickSign',
      `Told ${Array.from(new Set([request.sender.email, ...informed.map((s) => s.email), signer.email])).join(', ')}.`
    );
    saveRequest(request);
    res.json(signerView(request, signer));
  }));

  // The final signed PDF is built in the browser of whoever completes it, then stored and emailed to all
  router.put('/:token/final', express.raw({ type: () => true, limit: MAX_PDF }), withSigner(async (req, res, request) => {
    if (request.status !== 'completed') return res.status(400).json({ error: 'Not everyone has signed yet.' });
    if (request.hasSignedPdf) return res.json({ success: true, alreadyDone: true });
    if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ error: 'Invalid PDF.' });
    }

    fs.writeFileSync(signedFile(request.id), req.body);
    request.hasSignedPdf = true;
    // Fingerprint of the exact signed file, so any later change to it can be detected
    request.sha256Hash = crypto.createHash('sha256').update(req.body).digest('hex');
    audit(request, req, 'Signed copy created', 'QuickSign', `Final PDF stored. SHA-256 fingerprint: ${request.sha256Hash}.`);

    const recipients = Array.from(new Map(
      [{ name: request.sender.name, email: request.sender.email }, ...request.signers].map((p) => [p.email, p])
    ).values());
    const fileName = `${request.title.replace(/[^a-zA-Z0-9-_ ]/g, '_')} (signed).pdf`;
    const results: MailResult[] = [];
    for (const person of recipients) {
      const mail = emailLayout({
        heading: `"${request.title}" is fully signed`,
        paragraphs: [
          `Hi ${person.name},`,
          `Everyone has signed "${request.title}". Your copy of the signed document is attached to this email.`,
          `Signed by: ${request.signers.map((s) => s.name).join(', ')}.`,
          `Transaction ID: ${request.transactionId}`,
        ],
        footnote: `Document fingerprint (SHA-256): ${request.sha256Hash}`,
      });
      results.push(await sendMail({
        to: person.email,
        subject: `Signed copy: ${request.title}`,
        ...mail,
        attachments: [{ filename: fileName, content: req.body, contentType: 'application/pdf' }],
      }));
    }
    audit(request, req, 'Signed copies emailed', 'QuickSign', `Sent to ${recipients.map((p) => p.email).join(', ')}.`);
    saveRequest(request);
    res.json({ success: true, ...deliverySummary(results) });
  }));

  return router;
}
