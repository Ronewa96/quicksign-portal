import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { sendMail, emailLayout, publicAppUrl } from './mailer';
import { StoredUser, findUserById, findUserByEmail, insertUser, updateUserPassword, updateUserAvatar } from './db';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const MAX_AVATAR = '2mb';

const SESSION_COOKIE = 'qs_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MS = 60 * 60 * 1000; // password reset links last 1 hour

// Brute-force guard: max failed logins per IP within the window
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  title: string;
  organization: string;
  avatarUrl?: string;
}

export interface AuthedRequest extends Request {
  user?: PublicUser;
}

// ---------- Session secret ----------

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  ensureDataDir();
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, 'utf-8');
  return secret;
}

const SESSION_SECRET = getSessionSecret();

// ---------- Password hashing ----------

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, user: StoredUser): boolean {
  const candidate = Buffer.from(hashPassword(password, user.salt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// Used to keep login timing similar whether or not the email exists
const DUMMY_USER: StoredUser = {
  id: '',
  name: '',
  email: '',
  title: '',
  organization: '',
  salt: crypto.randomBytes(16).toString('hex'),
  passwordHash: crypto.randomBytes(64).toString('hex'),
  createdAt: '',
};

// ---------- Session tokens (HMAC-signed, stateless) ----------

function sign(value: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

type TokenType = 'session' | 'reset';

/**
 * Short fingerprint of the user's current password. Tokens carry it, so changing the password
 * signs out every other session and makes a used reset link stop working.
 */
const passwordStamp = (user: StoredUser) => sign(`pw:${user.passwordHash}`).slice(0, 16);

function createToken(user: StoredUser, typ: TokenType, ttlMs: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: user.id, typ, pv: passwordStamp(user), exp: Date.now() + ttlMs })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

const createSessionToken = (user: StoredUser) => createToken(user, 'session', SESSION_TTL_MS);

/** Returns the user a valid, unexpired token of this type belongs to. */
function readToken(token: string | undefined, typ: TokenType): StoredUser | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (data.typ !== typ || typeof data.uid !== 'string' || typeof data.exp !== 'number' || data.exp < Date.now()) {
      return null;
    }
    const user = findUserById(data.uid);
    return user && data.pv === passwordStamp(user) ? user : null;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function toPublicUser(u: StoredUser): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    title: u.title,
    organization: u.organization,
    avatarUrl: u.avatarUpdatedAt ? `/api/auth/avatar?v=${encodeURIComponent(u.avatarUpdatedAt)}` : undefined,
  };
}

// ---------- Profile photos ----------

const avatarFile = (userId: string) => path.join(AVATARS_DIR, `${userId}.img`);

/** Recognises the image formats we accept from their first bytes, not from what the browser claims. */
function imageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

// ---------- Rate limiting ----------

const failedAttempts = new Map<string, { count: number; firstAt: number }>();

function isRateLimited(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(ip: string) {
  const entry = failedAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    failedAttempts.set(ip, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

// ---------- Middleware ----------

export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  const user = readToken(parseCookies(req.headers.cookie)[SESSION_COOKIE], 'session');
  if (user) req.user = toPublicUser(user);
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

// ---------- Development account ----------

// Hard-coded login for local development. Never seeded in production.
const DEV_USER = {
  name: 'Alex Mercer',
  email: process.env.DEV_USER_EMAIL || 'test@example.com',
  password: process.env.DEV_USER_PASSWORD || 'QuickSign@2026',
  title: '',
  organization: '',
};

export function seedDevUser() {
  if (process.env.NODE_ENV === 'production') return;

  const email = DEV_USER.email.toLowerCase();
  if (findUserByEmail(email)) return;

  const salt = crypto.randomBytes(16).toString('hex');
  insertUser({
    id: `usr-${crypto.randomUUID()}`,
    name: DEV_USER.name,
    email,
    title: DEV_USER.title,
    organization: DEV_USER.organization,
    salt,
    passwordHash: hashPassword(DEV_USER.password, salt),
    createdAt: new Date().toISOString(),
  });
  console.log(`[QuickSign Auth] Seeded development account: ${email}`);
}

// ---------- Routes ----------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuthRouter() {
  const router = express.Router();

  router.post('/register', (req: AuthedRequest, res) => {
    const { name, email, password, title = '', organization = '' } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();

    if (!cleanName) return res.status(400).json({ error: 'Full name is required' });
    if (!EMAIL_PATTERN.test(cleanEmail)) return res.status(400).json({ error: 'A valid email address is required' });
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    if (findUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const user: StoredUser = {
      id: `usr-${crypto.randomUUID()}`,
      name: cleanName,
      email: cleanEmail,
      title: String(title).trim(),
      organization: String(organization).trim(),
      salt,
      passwordHash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    };

    insertUser(user);

    setSessionCookie(res, createSessionToken(user));
    res.status(201).json({ user: toPublicUser(user) });
  });

  router.post('/login', (req: AuthedRequest, res) => {
    const ip = req.ip || 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    }

    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const user = findUserByEmail(cleanEmail);

    const valid = verifyPassword(String(password || ''), user || DUMMY_USER) && Boolean(user);
    if (!valid || !user) {
      recordFailedAttempt(ip);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    failedAttempts.delete(ip);
    setSessionCookie(res, createSessionToken(user));
    res.json({ user: toPublicUser(user) });
  });

  // Emails a one-hour reset link. Always gives the same answer, so it can't reveal who has an account.
  router.post('/forgot-password', async (req: AuthedRequest, res, next) => {
    try {
      const ip = req.ip || 'unknown';
      if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      }
      recordFailedAttempt(ip); // counts toward the same limit, so the form can't be used to flood an inbox

      const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
      const user = findUserByEmail(cleanEmail);
      if (user) {
        const link = `${publicAppUrl(req)}/reset-password?token=${encodeURIComponent(createToken(user, 'reset', RESET_TTL_MS))}`;
        const mail = emailLayout({
          heading: 'Reset your QuickSign password',
          paragraphs: [
            `Hi ${user.name},`,
            'We received a request to reset your password. Click the button below to choose a new one.',
            'This link works once and expires in 1 hour.',
          ],
          button: { label: 'Choose a new password', url: link },
          footnote: "If you didn't ask for this, you can ignore this email. Your password stays the same.",
        });
        await sendMail({ to: user.email, subject: 'Reset your QuickSign password', ...mail });
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset-password', (req: AuthedRequest, res) => {
    const { token, password } = req.body || {};
    const user = readToken(String(token || ''), 'reset');
    if (!user) {
      return res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    updateUserPassword(user.id, salt, passwordHash);

    // The new password changes the stamp, so other sessions and this link stop working
    const updated = { ...user, salt, passwordHash };
    setSessionCookie(res, createSessionToken(updated));
    res.json({ user: toPublicUser(updated) });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ success: true });
  });

  router.get('/me', (req: AuthedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    res.json({ user: req.user });
  });

  // Profile photo of the signed-in user
  router.get('/avatar', (req: AuthedRequest, res) => {
    if (!req.user?.avatarUrl || !fs.existsSync(avatarFile(req.user.id))) return res.status(404).end();
    const image = fs.readFileSync(avatarFile(req.user.id));
    res.set('Cache-Control', 'private, max-age=31536000, immutable'); // the URL changes with each new photo
    res.type(imageType(image) || 'application/octet-stream').send(image);
  });

  router.put('/avatar', express.raw({ type: () => true, limit: MAX_AVATAR }), (req: AuthedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (!Buffer.isBuffer(req.body) || !imageType(req.body)) {
      return res.status(400).json({ error: 'The photo must be a JPG, PNG or WebP image.' });
    }
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
    fs.writeFileSync(avatarFile(req.user.id), req.body);

    updateUserAvatar(req.user.id, new Date().toISOString());
    res.json({ user: toPublicUser(findUserById(req.user.id)!) });
  });

  router.delete('/avatar', (req: AuthedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    fs.rmSync(avatarFile(req.user.id), { force: true });
    updateUserAvatar(req.user.id, null);
    res.json({ user: toPublicUser(findUserById(req.user.id)!) });
  });

  return router;
}
