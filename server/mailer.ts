import nodemailer, { Transporter } from 'nodemailer';
import fs from 'fs';
import path from 'path';

// Sends email through SMTP when configured (Gmail, Brevo, etc.).
// Without SMTP settings, emails are saved to data/outbox so the flow can be tested locally.

const OUTBOX_DIR = path.resolve(process.cwd(), 'data', 'outbox');

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface MailResult {
  to: string;
  delivered: boolean;
  /** 'smtp' when actually sent, 'outbox' when saved locally */
  via: 'smtp' | 'outbox';
  error?: string;
}

let transporter: Transporter | null = null;

/** Public base URL for links in emails: APP_URL when set, otherwise the address the request came in on. */
export function publicAppUrl(req: { protocol: string; get(name: string): string | undefined }) {
  const configured = process.env.APP_URL;
  if (configured && !configured.includes('MY_APP_URL')) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

export const isEmailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

function getTransporter(): Transporter {
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

const fromAddress = () => process.env.MAIL_FROM || `QuickSign <${process.env.SMTP_USER || 'no-reply@quicksign.local'}>`;

function saveToOutbox(message: MailMessage) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${stamp}-${message.to.replace(/[^a-zA-Z0-9@.-]/g, '_')}`;
  const attachmentList = (message.attachments || [])
    .map((a) => {
      const name = `${base}-${a.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      fs.writeFileSync(path.join(OUTBOX_DIR, name), a.content);
      return `<li><a href="${name}">${a.filename}</a></li>`;
    })
    .join('');
  const page =
    `<p style="font:12px monospace;color:#666">To: ${message.to}<br>Subject: ${message.subject}</p>` +
    message.html +
    (attachmentList ? `<p style="font:12px monospace">Attachments:</p><ul>${attachmentList}</ul>` : '');
  fs.writeFileSync(path.join(OUTBOX_DIR, `${base}.html`), page, 'utf-8');
  console.log(`[QuickSign Mail] Saved to outbox (SMTP not configured): "${message.subject}" -> ${message.to}`);
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!isEmailConfigured()) {
    saveToOutbox(message);
    return { to: message.to, delivered: true, via: 'outbox' };
  }
  try {
    await getTransporter().sendMail({ from: fromAddress(), ...message });
    return { to: message.to, delivered: true, via: 'smtp' };
  } catch (err: any) {
    console.error(`[QuickSign Mail] Failed to send to ${message.to}:`, err?.message);
    return { to: message.to, delivered: false, via: 'smtp', error: err?.message || 'Send failed' };
  }
}

// ---------- Email layout ----------

const escape = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Simple, widely compatible email layout with an optional button. */
export function emailLayout(opts: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footnote?: string }) {
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#27272a">${escape(p)}</p>`).join('');
  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${escape(opts.button.url)}" style="display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:6px">${escape(opts.button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#71717a">Or copy this link: ${escape(opts.button.url)}</p>`
    : '';
  const footnote = opts.footnote ? `<p style="margin:24px 0 0;font-size:12px;color:#71717a">${escape(opts.footnote)}</p>` : '';

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 20px;font-weight:700;font-size:16px;color:#09090b">QuickSign</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#09090b">${escape(opts.heading)}</h1>
${body}${button}${footnote}
</td></tr></table></td></tr></table></body></html>`;

  const text = [opts.heading, '', ...opts.paragraphs, ...(opts.button ? ['', `${opts.button.label}: ${opts.button.url}`] : []), ...(opts.footnote ? ['', opts.footnote] : [])].join('\n');
  return { html, text };
}
