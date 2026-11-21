import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// The QuickSign database (SQLite, built into Node.js). It holds accounts, signing requests, signers,
// signatures, audit trails, contacts and AI analyses. Uploaded PDFs and profile photos stay as files in data/.

const DATA_DIR = path.resolve(process.cwd(), 'data');
const REQUESTS_DIR = path.join(DATA_DIR, 'requests');
const ANALYSES_DIR = path.join(DATA_DIR, 'analyses');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const MIGRATED_SUFFIX = '.migrated';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  title: string;
  organization: string;
  passwordHash: string; // scrypt, hex
  salt: string; // hex
  createdAt: string;
  /** Set when the user has a profile photo in data/avatars; also busts the browser cache */
  avatarUpdatedAt?: string;
}

/** Where someone was when they opened, signed or declined. Sharing is optional. */
export type LocationRecord =
  | {
      shared: true;
      latitude: number;
      longitude: number;
      accuracy: number;
      place?: string;
      /** 'device': from the browser (GPS or Wi-Fi). 'network': approximate, from the internet address. */
      source?: 'device' | 'network';
    }
  | { shared: false; reason: 'declined' | 'unavailable' | 'skipped' };

export interface Signer {
  id: string;
  name: string;
  email: string;
  role: string;
  token: string;
  status: 'pending' | 'signed' | 'declined';
  viewedAt?: string;
  signedAt?: string;
  declinedAt?: string;
  /** Optional note from the signer explaining why they declined */
  declineReason?: string;
  /** Location when they opened the document (recorded once) */
  viewLocation?: LocationRecord;
  /** Location when they signed or declined */
  signLocation?: LocationRecord;
}

export interface Tag {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  type: 'signature' | 'initials' | 'date' | 'nameTag';
  signerName: string;
  signerEmail?: string;
  isCompleted: boolean;
  signatureDataUrl?: string;
  completedAt?: string;
  scale?: number;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  details: string;
  ipAddress: string;
  deviceInfo: string;
  location?: LocationRecord;
}

export interface AiSummary {
  analysisId: string;
  source: 'gemini' | 'fallback';
  model?: string;
  summary: string;
  keyPoints: string[];
  overallRisk: 'low' | 'medium' | 'high';
  disclaimer: string;
}

export interface SignRequest {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  sender: { userId: string; name: string; email: string };
  pages: string[];
  rawText: string;
  hasOriginal: boolean;
  /** The sender signs before anyone else; the others are emailed only after that */
  senderSignsFirst?: boolean;
  /** 'sequential': signers sign one after another in list order */
  signingOrder?: 'parallel' | 'sequential';
  signers: Signer[];
  tags: Tag[];
  auditTrail: AuditEvent[];
  /** 'declined': a signer refused to sign, which stops the request for everyone */
  status: 'draft' | 'pending' | 'completed' | 'declined';
  transactionId?: string;
  completedAt?: string;
  declinedAt?: string;
  sha256Hash?: string;
  hasSignedPdf: boolean;
  /** Plain-language AI summary the sender chose to share with the signers */
  aiSummary?: AiSummary;
}

export interface Contact {
  name: string;
  email: string;
  role: string;
  lastUsed: string;
  timesUsed: number;
}

// ---------- Connection and schema ----------

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'quicksign.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    avatar_updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'completed', 'declined')),
    signing_order TEXT NOT NULL DEFAULT 'parallel' CHECK (signing_order IN ('parallel', 'sequential')),
    pages TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    has_original INTEGER NOT NULL DEFAULT 0,
    has_signed_pdf INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT,
    completed_at TEXT,
    declined_at TEXT,
    transaction_id TEXT,
    sha256_hash TEXT,
    ai_summary TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests_sender ON requests(sender_user_id, created_at);

  CREATE TABLE IF NOT EXISTS signers (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'signed', 'declined')),
    viewed_at TEXT,
    signed_at TEXT,
    declined_at TEXT,
    decline_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_signers_request ON signers(request_id, position);

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    page_index INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    type TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    signer_email TEXT,
    is_completed INTEGER NOT NULL,
    signature_data_url TEXT,
    completed_at TEXT,
    scale REAL
  );
  CREATE INDEX IF NOT EXISTS idx_tags_request ON tags(request_id, position);

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    details TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    device_info TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_events(request_id, position);

  CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    last_used TEXT NOT NULL,
    times_used INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, email)
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
`);

/** Adds a column to an existing database the first time a newer version of QuickSign starts. */
function addColumnIfMissing(table: string, column: string, type: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumnIfMissing('signers', 'view_location', 'TEXT');
addColumnIfMissing('signers', 'sign_location', 'TEXT');
addColumnIfMissing('audit_events', 'location', 'TEXT');
addColumnIfMissing('requests', 'sender_signs_first', 'INTEGER NOT NULL DEFAULT 0');

const toJson = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));
const fromJson = (value: string | null | undefined) => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

let transactionDepth = 0;

/** Runs the work as one all-or-nothing transaction. An error undoes everything it changed. */
function transaction<T>(work: () => T): T {
  if (transactionDepth > 0) return work();
  db.exec('BEGIN IMMEDIATE');
  transactionDepth += 1;
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    transactionDepth -= 1;
  }
}

const orNull = <T>(value: T | undefined | null) => (value === undefined ? null : value);
const orUndefined = <T>(value: T | null | undefined) => (value === null ? undefined : value);

// ---------- Users ----------

const toUser = (row: any): StoredUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  title: row.title,
  organization: row.organization,
  passwordHash: row.password_hash,
  salt: row.salt,
  createdAt: row.created_at,
  avatarUpdatedAt: orUndefined(row.avatar_updated_at),
});

export function findUserById(id: string): StoredUser | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? toUser(row) : null;
}

export function findUserByEmail(email: string): StoredUser | null {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  return row ? toUser(row) : null;
}

export function insertUser(user: StoredUser) {
  db.prepare(
    `INSERT INTO users (id, name, email, title, organization, password_hash, salt, created_at, avatar_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(user.id, user.name, user.email, user.title, user.organization, user.passwordHash, user.salt, user.createdAt, orNull(user.avatarUpdatedAt));
}

export function updateUserPassword(id: string, salt: string, passwordHash: string) {
  db.prepare('UPDATE users SET salt = ?, password_hash = ? WHERE id = ?').run(salt, passwordHash, id);
}

export function updateUserAvatar(id: string, avatarUpdatedAt: string | null) {
  db.prepare('UPDATE users SET avatar_updated_at = ? WHERE id = ?').run(avatarUpdatedAt, id);
}

// ---------- Signing requests ----------

function toRequest(row: any): SignRequest {
  const id = row.id;
  const signers = db.prepare('SELECT * FROM signers WHERE request_id = ? ORDER BY position').all(id) as any[];
  const tags = db.prepare('SELECT * FROM tags WHERE request_id = ? ORDER BY position').all(id) as any[];
  const events = db.prepare('SELECT * FROM audit_events WHERE request_id = ? ORDER BY position').all(id) as any[];
  return {
    id,
    title: row.title,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: orUndefined(row.sent_at),
    sender: { userId: row.sender_user_id, name: row.sender_name, email: row.sender_email },
    pages: JSON.parse(row.pages),
    rawText: row.raw_text,
    hasOriginal: Boolean(row.has_original),
    signingOrder: row.signing_order,
    senderSignsFirst: Boolean(row.sender_signs_first),
    status: row.status,
    transactionId: orUndefined(row.transaction_id),
    completedAt: orUndefined(row.completed_at),
    declinedAt: orUndefined(row.declined_at),
    sha256Hash: orUndefined(row.sha256_hash),
    hasSignedPdf: Boolean(row.has_signed_pdf),
    aiSummary: row.ai_summary ? JSON.parse(row.ai_summary) : undefined,
    signers: signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      role: s.role,
      token: s.token,
      status: s.status,
      viewedAt: orUndefined(s.viewed_at),
      signedAt: orUndefined(s.signed_at),
      declinedAt: orUndefined(s.declined_at),
      declineReason: orUndefined(s.decline_reason),
      viewLocation: fromJson(s.view_location),
      signLocation: fromJson(s.sign_location),
    })),
    tags: tags.map((t) => ({
      id: t.id,
      pageIndex: t.page_index,
      x: t.x,
      y: t.y,
      type: t.type,
      signerName: t.signer_name,
      signerEmail: orUndefined(t.signer_email),
      isCompleted: Boolean(t.is_completed),
      signatureDataUrl: orUndefined(t.signature_data_url),
      completedAt: orUndefined(t.completed_at),
      scale: orUndefined(t.scale),
    })),
    auditTrail: events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      action: e.action,
      actor: e.actor,
      details: e.details,
      ipAddress: e.ip_address,
      deviceInfo: e.device_info,
      location: fromJson(e.location),
    })),
  };
}

export function findRequestById(id: string): SignRequest | null {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  return row ? toRequest(row) : null;
}

export function findRequestBySignerToken(token: string): { request: SignRequest; signer: Signer } | null {
  const row = db.prepare('SELECT request_id FROM signers WHERE token = ?').get(token) as any;
  const request = row ? findRequestById(row.request_id) : null;
  const signer = request?.signers.find((s) => s.token === token);
  return request && signer ? { request, signer } : null;
}

/** A user's sent requests (not drafts), newest first. */
export function requestsSentBy(userId: string): SignRequest[] {
  const rows = db
    .prepare(`SELECT * FROM requests WHERE sender_user_id = ? AND status != 'draft' ORDER BY created_at DESC`)
    .all(userId);
  return rows.map(toRequest);
}

/** Saves a request and everything that belongs to it, all together or not at all. */
export function saveRequestRecord(request: SignRequest) {
  transaction(() => {
    db.prepare(
      `INSERT INTO requests (id, sender_user_id, sender_name, sender_email, title, category, status, signing_order, pages, raw_text,
         has_original, has_signed_pdf, created_at, updated_at, sent_at, completed_at, declined_at, transaction_id, sha256_hash, ai_summary,
         sender_signs_first)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, category = excluded.category, status = excluded.status, signing_order = excluded.signing_order,
         pages = excluded.pages, raw_text = excluded.raw_text, has_original = excluded.has_original, has_signed_pdf = excluded.has_signed_pdf,
         updated_at = excluded.updated_at, sent_at = excluded.sent_at, completed_at = excluded.completed_at, declined_at = excluded.declined_at,
         transaction_id = excluded.transaction_id, sha256_hash = excluded.sha256_hash, ai_summary = excluded.ai_summary,
         sender_signs_first = excluded.sender_signs_first`
    ).run(
      request.id,
      request.sender.userId,
      request.sender.name,
      request.sender.email,
      request.title,
      request.category,
      request.status,
      request.signingOrder || 'parallel',
      JSON.stringify(request.pages),
      request.rawText,
      request.hasOriginal ? 1 : 0,
      request.hasSignedPdf ? 1 : 0,
      request.createdAt,
      request.updatedAt,
      orNull(request.sentAt),
      orNull(request.completedAt),
      orNull(request.declinedAt),
      orNull(request.transactionId),
      orNull(request.sha256Hash),
      request.aiSummary ? JSON.stringify(request.aiSummary) : null,
      request.senderSignsFirst ? 1 : 0
    );

    db.prepare('DELETE FROM signers WHERE request_id = ?').run(request.id);
    const insertSigner = db.prepare(
      `INSERT INTO signers (id, request_id, position, name, email, role, token, status, viewed_at, signed_at, declined_at, decline_reason,
         view_location, sign_location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    request.signers.forEach((s, i) =>
      insertSigner.run(s.id, request.id, i, s.name, s.email, s.role, s.token, s.status, orNull(s.viewedAt), orNull(s.signedAt), orNull(s.declinedAt), orNull(s.declineReason),
        toJson(s.viewLocation), toJson(s.signLocation))
    );

    db.prepare('DELETE FROM tags WHERE request_id = ?').run(request.id);
    const insertTag = db.prepare(
      `INSERT INTO tags (id, request_id, position, page_index, x, y, type, signer_name, signer_email, is_completed, signature_data_url, completed_at, scale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    request.tags.forEach((t, i) =>
      insertTag.run(t.id, request.id, i, t.pageIndex, t.x, t.y, t.type, t.signerName, orNull(t.signerEmail), t.isCompleted ? 1 : 0, orNull(t.signatureDataUrl), orNull(t.completedAt), orNull(t.scale))
    );

    db.prepare('DELETE FROM audit_events WHERE request_id = ?').run(request.id);
    const insertEvent = db.prepare(
      `INSERT INTO audit_events (id, request_id, position, timestamp, action, actor, details, ip_address, device_info, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    request.auditTrail.forEach((e, i) => insertEvent.run(e.id, request.id, i, e.timestamp, e.action, e.actor, e.details, e.ipAddress, e.deviceInfo, toJson(e.location)));
  });
}

export function deleteRequestRecord(id: string) {
  db.prepare('DELETE FROM requests WHERE id = ?').run(id); // signers, tags and audit events go with it
}

// ---------- Contacts ----------

/** Remembers everyone a user sends documents to. */
export function rememberContactRecords(userId: string, people: Array<{ name: string; email: string; role: string }>, lastUsed: string, timesUsed = 1) {
  const upsert = db.prepare(
    `INSERT INTO contacts (user_id, email, name, role, last_used, times_used) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, email) DO UPDATE SET
       name = COALESCE(NULLIF(excluded.name, ''), name),
       role = COALESCE(NULLIF(excluded.role, ''), role),
       last_used = excluded.last_used,
       times_used = times_used + excluded.times_used`
  );
  transaction(() => people.forEach((p) => upsert.run(userId, p.email, p.name, p.role, lastUsed, timesUsed)));
}

export function contactsOf(userId: string): Contact[] {
  const rows = db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY last_used DESC').all(userId) as any[];
  return rows.map((c) => ({ name: c.name, email: c.email, role: c.role, lastUsed: c.last_used, timesUsed: c.times_used }));
}

export function deleteContact(userId: string, email: string) {
  db.prepare('DELETE FROM contacts WHERE user_id = ? AND email = ?').run(userId, email);
}

// ---------- AI analyses ----------

export function saveAnalysisRecord(id: string, userId: string, textHash: string, createdAt: string, data: object) {
  db.prepare('INSERT INTO analyses (id, user_id, text_hash, created_at, data) VALUES (?, ?, ?, ?, ?)').run(id, userId, textHash, createdAt, JSON.stringify(data));
}

export function findAnalysisRecord(id: string): { userId: string; textHash: string; data: any } | null {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as any;
  return row ? { userId: row.user_id, textHash: row.text_hash, data: JSON.parse(row.data) } : null;
}

// ---------- One-time import of the old JSON files ----------

function readJsonFile(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[QuickSign DB] Could not read ${path.basename(file)}, leaving it in place:`, err);
    return null;
  }
}

const jsonFilesIn = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : [];

/** Imports data from before the database existed. Imported files are kept, renamed to *.json.migrated. */
function importJsonFiles() {
  const imported: string[] = [];
  const counts = { users: 0, contacts: 0, requests: 0, analyses: 0 };

  transaction(() => {
    if (fs.existsSync(USERS_FILE)) {
      const users = readJsonFile(USERS_FILE);
      if (Array.isArray(users)) {
        for (const user of users) {
          if (!findUserByEmail(user.email) && !findUserById(user.id)) {
            insertUser(user);
            counts.users += 1;
          }
        }
        imported.push(USERS_FILE);
      }
    }

    for (const file of jsonFilesIn(REQUESTS_DIR)) {
      const request = readJsonFile(file);
      if (!request) continue;
      if (!findUserById(request.sender?.userId)) {
        console.warn(`[QuickSign DB] Skipped ${path.basename(file)}: its sender no longer exists.`);
        continue;
      }
      saveRequestRecord(request);
      imported.push(file);
      counts.requests += 1;
    }

    if (fs.existsSync(CONTACTS_FILE)) {
      const all = readJsonFile(CONTACTS_FILE);
      if (all) {
        for (const [userId, list] of Object.entries<Contact[]>(all)) {
          if (!findUserById(userId)) continue;
          for (const c of list) {
            rememberContactRecords(userId, [c], c.lastUsed, c.timesUsed);
            counts.contacts += 1;
          }
        }
        imported.push(CONTACTS_FILE);
      }
    }

    for (const file of jsonFilesIn(ANALYSES_DIR)) {
      const stored = readJsonFile(file);
      if (!stored) continue;
      if (findUserById(stored.userId)) {
        const { userId, textHash, ...data } = stored;
        saveAnalysisRecord(data.id, userId, textHash, data.createdAt, data);
        counts.analyses += 1;
      }
      imported.push(file);
    }
  });

  // Only after the transaction has succeeded, so a failed import leaves the old files untouched
  for (const file of imported) fs.renameSync(file, file + MIGRATED_SUFFIX);
  if (imported.length > 0) console.log('[QuickSign DB] Imported old data files:', JSON.stringify(counts));
}

importJsonFiles();
