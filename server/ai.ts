import express from 'express';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { AuthedRequest } from './auth';
import { saveAnalysisRecord, findAnalysisRecord } from './db';
import { DOCUMENT_CATEGORIES } from '../src/lib/categories';

// AI document review (the emerging-technology component): Google Gemini reads a document and returns a
// structured summary, risks and a suggested category. The input is checked before it is sent, the output
// is checked before it is used, and every result is saved so a signing request can attach it.

export const MIN_WORDS = 30;
const MAX_INPUT_CHARS = 2_000_000;
const MAX_MODEL_CHARS = 15_000;
const MAX_CHAT_MESSAGE = 2_000;
const AI_TIMEOUT_MS = 30_000; // per model
// Tried in order: a busy model or a used-up quota moves on to the next one
const MODELS = Array.from(new Set([process.env.GEMINI_MODEL || 'gemini-3.8-flash', process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite']));

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey && apiKey !== 'MY_GEMINI_API_KEY' ? new GoogleGenAI({ apiKey }) : null;
export const isAiConfigured = () => ai !== null;

type RiskLevel = 'low' | 'medium' | 'high';
const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high'];

interface Risk {
  title: string;
  level: RiskLevel;
  clauseSnippet?: string;
  explanation: string;
  recommendation: string;
}

export interface DocumentAnalysis {
  id: string;
  createdAt: string;
  /** 'gemini' = produced by the AI model; 'fallback' = basic keyword check when the AI is unavailable */
  source: 'gemini' | 'fallback';
  model?: string;
  notice?: string;
  truncated: boolean;
  wordCount: number;
  summary: string;
  keyPoints: string[];
  governingLaw: string;
  identifiedParties: string[];
  estimatedReviewTime: string;
  readabilityGrade: string;
  suggestedCategory: string;
  overallRisk: RiskLevel;
  risks: Risk[];
  disclaimer: string;
}

const DISCLAIMER = 'This summary is for information only and is not legal advice.';

// ---------- Input ----------

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();
export const textFingerprint = (text: string) => crypto.createHash('sha256').update(normalise(text)).digest('hex');
const countWords = (text: string) => (normalise(text) ? normalise(text).split(' ').length : 0);

/** Returns a plain-language reason when the text can't be analysed, or null when it is fine. */
export function checkAnalysisInput(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return 'There is no document text to analyse.';
  if (text.length > MAX_INPUT_CHARS) return 'This document is too long to analyse.';
  const words = countWords(text);
  if (words < MIN_WORDS) {
    return `This document has too little readable text to analyse (${words} word${words === 1 ? '' : 's'}; at least ${MIN_WORDS} are needed). Scanned pages are images and can't be read.`;
  }
  return null;
}

// ---------- Output checks ----------

const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, maxItems).map((x: string) => x.trim().slice(0, maxLen)) : [];

const toLevel = (v: unknown): RiskLevel => {
  const level = String(v || '').toLowerCase();
  return (RISK_ORDER as string[]).includes(level) ? (level as RiskLevel) : 'medium';
};

const toCategory = (v: unknown) =>
  DOCUMENT_CATEGORIES.find((c) => c.toLowerCase() === String(v || '').trim().toLowerCase()) || 'Other';

const highestRisk = (risks: Risk[]): RiskLevel =>
  risks.reduce<RiskLevel>((max, r) => (RISK_ORDER.indexOf(r.level) > RISK_ORDER.indexOf(max) ? r.level : max), 'low');

/** Keeps only well-formed fields from the model's answer. Throws if the essential parts are missing. */
function checkModelOutput(raw: any): Omit<DocumentAnalysis, 'id' | 'createdAt' | 'source' | 'model' | 'notice' | 'truncated' | 'wordCount'> {
  const summary = str(raw?.summary, 3000);
  if (!summary) throw new Error('AI response had no summary');
  const risks: Risk[] = (Array.isArray(raw?.risks) ? raw.risks : [])
    .filter((r: any) => r && str(r.title, 200))
    .slice(0, 12)
    .map((r: any) => ({
      title: str(r.title, 200),
      level: toLevel(r.level),
      clauseSnippet: str(r.clauseSnippet, 400) || undefined,
      explanation: str(r.explanation, 800, 'No explanation given.'),
      recommendation: str(r.recommendation, 800, 'Review this part of the document carefully.'),
    }));
  return {
    summary,
    keyPoints: strList(raw?.keyPoints, 8, 400),
    governingLaw: str(raw?.governingLaw, 200, 'Not specified'),
    identifiedParties: strList(raw?.identifiedParties, 10, 200),
    estimatedReviewTime: str(raw?.estimatedReviewTime, 50),
    readabilityGrade: str(raw?.readabilityGrade, 50, 'Moderate'),
    suggestedCategory: toCategory(raw?.suggestedCategory),
    overallRisk: highestRisk(risks),
    risks,
    disclaimer: str(raw?.disclaimer, 300, DISCLAIMER),
  };
}

// ---------- Gemini ----------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('AI request timed out')), ms))]);
}

async function withModelFallback<T>(work: (model: string) => Promise<T>): Promise<{ model: string; value: T }> {
  let lastError: unknown;
  for (const model of MODELS) {
    try {
      return { model, value: await withTimeout(work(model), AI_TIMEOUT_MS) };
    } catch (err: any) {
      console.warn(`Gemini model ${model} failed: ${String(err?.message || err).slice(0, 160)}`);
      lastError = err;
    }
  }
  throw lastError;
}

async function analyseWithGemini(title: string, text: string, legalMode: boolean) {
  const prompt = `Analyze the following document named "${title || 'Document'}".
${legalMode ? 'Perform a careful legal risk review, identifying potential liabilities, non-standard clauses, indemnities, one-sided terms, and critical obligations.' : 'Provide a high-level summary and key terms.'}
Choose suggestedCategory from exactly one of: ${DOCUMENT_CATEGORIES.join('; ')}.

Document content:
---
${text.slice(0, MAX_MODEL_CHARS)}
---`;

  const { model, value: response } = await withModelFallback((candidate) =>
    ai!.models.generateContent({
      model: candidate,
      contents: prompt,
      config: {
        systemInstruction:
          'You are the QuickSign document assistant. You review agreements, contracts and business documents and explain them clearly and accurately, in plain language that someone without legal training can understand. Only describe what is actually in the document. Always include a short note that your output is for information only and is not legal advice.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: 'A clear 2-3 paragraph plain-language summary of what the document is for and what it covers.' },
            keyPoints: { type: Type.ARRAY, items: { type: Type.STRING }, description: '4 to 6 crucial terms, amounts, deadlines or obligations.' },
            governingLaw: { type: Type.STRING, description: 'Governing law or jurisdiction if stated, otherwise "Not specified".' },
            identifiedParties: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Names or roles of the parties.' },
            estimatedReviewTime: { type: Type.STRING, description: 'e.g. "3 min read"' },
            readabilityGrade: { type: Type.STRING, description: '"Easy", "Moderate" or "Complex"' },
            suggestedCategory: { type: Type.STRING, description: 'Exactly one category from the list in the prompt.' },
            risks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  level: { type: Type.STRING, description: 'low, medium, or high' },
                  clauseSnippet: { type: Type.STRING, description: 'Short quote from the document' },
                  explanation: { type: Type.STRING },
                  recommendation: { type: Type.STRING },
                },
                required: ['title', 'level', 'explanation', 'recommendation'],
              },
            },
            disclaimer: { type: Type.STRING },
          },
          required: ['summary', 'keyPoints', 'risks', 'suggestedCategory'],
        },
      },
    })
  );
  return { model, ...checkModelOutput(JSON.parse(response.text || '{}')) };
}

// ---------- Basic keyword check (used when the AI is unavailable) ----------

const RISK_RULES: Array<{ pattern: RegExp; title: string; level: RiskLevel; explanation: string; recommendation: string }> = [
  {
    pattern: /indemnif|hold harmless/i,
    title: "Paying for the other side's losses (indemnity)",
    level: 'high',
    explanation: "One party may have to cover the other party's losses or legal costs.",
    recommendation: 'Check whether this applies to both sides and whether there is a maximum amount.',
  },
  {
    pattern: /unlimited liability|liable for all|consequential (loss|damage)/i,
    title: 'Liability for losses',
    level: 'high',
    explanation: 'A party may be responsible for large or indirect losses.',
    recommendation: 'Ask for a cap on liability, for example the total fees paid.',
  },
  {
    pattern: /non-compet|not compete|exclusiv/i,
    title: 'Restriction on working with others',
    level: 'medium',
    explanation: 'A party may be stopped from working with competitors or other clients.',
    recommendation: 'Check how long the restriction lasts and which businesses it covers.',
  },
  {
    pattern: /sole discretion|terminate[^.]{0,60}(at any time|without cause)/i,
    title: 'One-sided right to end or change the agreement',
    level: 'medium',
    explanation: 'One party may be able to end or change the agreement on its own.',
    recommendation: 'Ask for a notice period and payment for work already done.',
  },
  {
    pattern: /penalt|late (payment )?(fee|charge)|liquidated damages|interest[^.]{0,40}(overdue|late)/i,
    title: 'Penalties or late-payment charges',
    level: 'medium',
    explanation: 'Extra charges may apply if a deadline or payment is missed.',
    recommendation: 'Check the amounts and when they apply.',
  },
  {
    pattern: /auto(matic(ally)?)?[- ]?renew/i,
    title: 'Automatic renewal',
    level: 'medium',
    explanation: 'The agreement may continue automatically unless someone cancels in time.',
    recommendation: 'Note the cancellation deadline.',
  },
  {
    pattern: /intellectual property|work made for hire|assigns? all rights/i,
    title: 'Ownership of work or ideas',
    level: 'low',
    explanation: 'The document says who owns the work, designs or ideas produced.',
    recommendation: 'Make sure anything you owned before the agreement stays yours.',
  },
  {
    pattern: /confidential/i,
    title: 'Confidentiality',
    level: 'low',
    explanation: 'Some information must be kept private.',
    recommendation: 'Check what counts as confidential and for how long.',
  },
];

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/non-disclosure|\bnda\b|confidentiality agreement/i, 'Non-Disclosure Agreement (NDA)'],
  [/employ(ee|er|ment)|salary|job title/i, 'Employment Contract'],
  [/\blease\b|\brent(al)?\b|tenant|landlord/i, 'Lease / Rental Agreement'],
  [/\bloan\b|borrow|lender|repay/i, 'Loan Agreement'],
  [/purchase order|\bp\.?o\.? number/i, 'Purchase Order'],
  [/invoice|quotation|\bquote\b/i, 'Invoice / Quotation'],
  [/consult/i, 'Consulting Agreement'],
  [/partnership|partners agree/i, 'Partnership Agreement'],
  [/\bbuyer\b|\bseller\b|sale of/i, 'Sales Contract'],
  [/services?|design|develop|deliver/i, 'Service Agreement'],
];

function analyseWithKeywords(text: string) {
  const sentences = normalise(text).split(/(?<=[.!?])\s+/);
  const quote = (pattern: RegExp) => {
    const s = sentences.find((x) => pattern.test(x));
    return s ? (s.length > 220 ? `${s.slice(0, 217)}…` : s) : undefined;
  };

  const risks: Risk[] = RISK_RULES.filter((r) => r.pattern.test(text)).map((r) => ({
    title: r.title,
    level: r.level,
    clauseSnippet: quote(r.pattern),
    explanation: r.explanation,
    recommendation: r.recommendation,
  }));
  if (risks.length === 0) {
    risks.push({
      title: 'No common risk terms found',
      level: 'low',
      explanation: 'The basic check found none of the usual risk terms, such as indemnity, penalties or non-compete clauses.',
      recommendation: 'Still read the whole document before signing.',
    });
  }

  const words = countWords(text);
  const category = CATEGORY_RULES.find(([p]) => p.test(text))?.[1] || 'Other';
  const amounts = Array.from(new Set(text.match(/(?:\bR|\bZAR|\$|\bUSD|€|£)\s?\d+(?:[ ,]\d{3})*(?:\.\d+)?/g) || [])).map((a) => a.trim()).slice(0, 5);
  const periods = Array.from(new Set(text.match(/\b\d+\s+(?:business\s+)?(?:days?|weeks?|months?|years?)\b/gi) || [])).slice(0, 5);
  const parties = text.match(/between\s+(.{2,80}?)\s+and\s+(.{2,80}?)(?:[,.(]|\s+for\s)/i);
  const law = text.match(/governed by (?:and construed in accordance with )?the laws? of ([^.,;]{2,60})/i);
  const avgSentence = words / Math.max(1, sentences.length);
  const realRisks = risks.filter((r) => r.title !== 'No common risk terms found');

  const keyPoints = [
    amounts.length ? `Amounts mentioned: ${amounts.join(', ')}.` : '',
    periods.length ? `Time periods mentioned: ${periods.join(', ')}.` : '',
    parties ? `Parties: ${parties[1].trim()} and ${parties[2].trim()}.` : '',
    `Length: ${words} words (about ${Math.max(1, Math.ceil(words / 220))} min read).`,
  ].filter(Boolean);

  return {
    summary:
      `Basic check without AI: this looks like a ${category === 'Other' ? 'general document' : category.toLowerCase()} of ${words} words. ` +
      (amounts.length || periods.length
        ? `It mentions ${[amounts.length ? `amounts (${amounts.join(', ')})` : '', periods.length ? `time periods (${periods.join(', ')})` : ''].filter(Boolean).join(' and ')}. `
        : '') +
      (realRisks.length
        ? `${realRisks.length} possible risk area${realRisks.length === 1 ? ' was' : 's were'} found: ${realRisks.map((r) => r.title.toLowerCase()).join('; ')}.`
        : 'No common risk terms were found.'),
    keyPoints,
    governingLaw: law ? law[1].trim() : 'Not specified',
    identifiedParties: parties ? [parties[1].trim(), parties[2].trim()] : [],
    estimatedReviewTime: `${Math.max(1, Math.ceil(words / 220))} min read`,
    readabilityGrade: avgSentence > 25 ? 'Complex' : avgSentence > 15 ? 'Moderate' : 'Easy',
    suggestedCategory: category,
    overallRisk: highestRisk(risks),
    risks,
    disclaimer: DISCLAIMER,
  };
}

// ---------- Run and store ----------

export async function analyseDocument(userId: string, title: string, text: string, legalMode = true): Promise<DocumentAnalysis> {
  const base = {
    id: `ana-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    createdAt: new Date().toISOString(),
    truncated: text.length > MAX_MODEL_CHARS,
    wordCount: countWords(text),
  };

  let result: DocumentAnalysis;
  if (ai) {
    try {
      result = { ...base, source: 'gemini', ...(await analyseWithGemini(title, text, legalMode)) };
    } catch (err) {
      console.error('Gemini analysis failed, using the basic check instead:', err);
      result = {
        ...base,
        source: 'fallback',
        notice: "The AI service couldn't be reached, so a basic keyword check was used instead.",
        ...analyseWithKeywords(text),
      };
    }
  } else {
    result = {
      ...base,
      source: 'fallback',
      notice: 'No Gemini API key is set up, so a basic keyword check was used instead of AI.',
      ...analyseWithKeywords(text),
    };
  }

  saveAnalysisRecord(result.id, userId, textFingerprint(text), result.createdAt, result);
  return result;
}

/**
 * The saved analysis a user wants to attach to a signing request, but only if it is theirs and was made
 * from this exact document text. Returns null otherwise.
 */
export function analysisForDocument(id: unknown, userId: string, text: string): DocumentAnalysis | null {
  if (typeof id !== 'string' || !/^ana-[a-z0-9]+-[a-f0-9]{6}$/.test(id)) return null;
  const stored = findAnalysisRecord(id);
  return stored && stored.userId === userId && stored.textHash === textFingerprint(text) ? stored.data : null;
}

// ---------- Routes ----------

export function createAiRouter() {
  const router = express.Router();

  router.post('/analyze', async (req: AuthedRequest, res) => {
    const { documentTitle, documentText, isLegalMode = true } = req.body || {};
    const problem = checkAnalysisInput(documentText);
    if (problem) return res.status(400).json({ error: problem });
    try {
      res.json(await analyseDocument(req.user!.id, String(documentTitle || '').slice(0, 200), documentText, Boolean(isLegalMode)));
    } catch (err) {
      console.error('Analysis error:', err);
      res.status(500).json({ error: 'The document could not be analysed. Please try again.' });
    }
  });

  router.post('/chat', async (req: AuthedRequest, res) => {
    const { message, documentTitle, documentText, history = [] } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Type a question first.' });
    if (message.length > MAX_CHAT_MESSAGE) {
      return res.status(400).json({ error: `Keep your question under ${MAX_CHAT_MESSAGE} characters.` });
    }
    const title = String(documentTitle || 'this document').slice(0, 200);
    const text = typeof documentText === 'string' ? documentText : '';

    let notice = '';
    if (ai) {
      try {
        const contents = (Array.isArray(history) ? history : [])
          .slice(-6)
          .filter((h: any) => typeof h?.text === 'string')
          .map((h: any) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text.slice(0, MAX_CHAT_MESSAGE * 2) }] }));
        contents.push({ role: 'user', parts: [{ text: message }] });
        const { value: reply } = await withModelFallback((candidate) =>
          ai!.models.generateContent({
            model: candidate,
            contents,
            config: {
              systemInstruction: `You are the QuickSign document assistant. Answer questions about the document "${title}" only.
Be clear, accurate and concise, in plain language. Quote the relevant clause when the answer is in the document; if it isn't, say so.
Where relevant, remind the user that this is not legal advice.

Document text:
---
${text.slice(0, 16000)}
---`,
            },
          })
        );
        return res.json({ reply: reply.text || "Sorry, I couldn't produce an answer.", timestamp: new Date().toISOString() });
      } catch (err) {
        console.error('Gemini chat failed, using a general answer instead:', err);
        notice = "(The AI service couldn't be reached, so this is a general answer.)\n\n";
      }
    }

    // General answers when the AI is unavailable
    const q = message.toLowerCase();
    let answer: string;
    if (/risk|danger|problem|liabilit/.test(q)) {
      answer = `Things to check for risk in "${title}":\n- Who must pay if something goes wrong (indemnity), and whether there is a limit.\n- Which law applies, and how disputes are settled.\n- How much notice is needed to end the agreement.\n\nThis is general guidance, not legal advice.`;
    } else if (/sign|who|parties/.test(q)) {
      answer = 'The people who need to sign are listed on the document. Each signature is recorded with a date and time in the audit trail.';
    } else if (/pay|price|cost|fee/.test(q)) {
      answer = "Check the document's payment section for the amount, due dates and any late-payment charges.";
    } else if (/terminat|cancel|end/.test(q)) {
      answer = 'Check the termination section for how much written notice is needed, and whether there is time to fix a problem first.';
    } else {
      answer = `I can only give general answers right now. For "${title}", try asking about risks, signers, payment or ending the agreement.`;
    }
    res.json({ reply: notice + answer, timestamp: new Date().toISOString() });
  });

  return router;
}
