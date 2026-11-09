# QuickSign Portal

Upload, sign, send, and convert documents in one place, with AI summaries and a full record of who signed what.

## Features

### Sign documents
- Upload a PDF and sign it exactly as it looks. The original layout is kept.
- Drag a signature box, date, or your saved signature onto any page.
- Create a signature by drawing it, typing your name in one of four styles, or uploading an image.
- Download the signed document as a PDF with your signature in place.

### Send documents for signing
- Upload a file (PDF, Word, text, Markdown, HTML, or JSON) or paste the text.
- Add the people who need to sign, then send it or sign it yourself.
- An AI review suggests the category, summarises the document for the signers, and asks you to confirm high-risk items.
- Signers get a private link by email and can sign or decline. Everyone receives the signed PDF. Without SMTP settings, emails are saved to `data/outbox`.

### View documents
- Read documents with zoom, page navigation, search, printing, and PDF download.

### Convert files
- Convert between PDF, Word, Markdown, plain text, HTML, and JSON, and download the result.

### AI assistant
- Upload a document to get a plain-language summary, key points, and possible risks.
- Ask questions about the document in a chat.
- Past analyses are saved in your history.
- AI output is for information only and is not legal advice.

### Audit trail
- See who signed each document, when, and every action taken on it.
- Download a signing certificate as a PDF.

### Accounts and settings
- Sign in with an email and password.
- Update your name, job title, organization, initials, and saved signature.
- Switch between dark and light mode.

## Running locally

```bash
npm install --legacy-peer-deps
npm run dev
```

Then open http://localhost:3000.

In development, a test account is created automatically (see `DEV_USER` in `server/auth.ts`).

To turn on AI summaries, set `GEMINI_API_KEY` in your environment before starting the server. Without it, the AI assistant gives general answers only.

## Tech stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4
- **Backend**: Node.js 22.13 or newer and Express (`server.ts`), with Vite in development
- **Database**: SQLite, built into Node.js (`data/quicksign.db`, code in `server/db.ts`). PDFs and profile photos are files in `data/`. Older JSON data files are imported automatically on first start and kept as `*.migrated`.
- **PDF**: PDF.js for display and text extraction, pdf-lib for creating PDFs
- **AI**: Google Gemini via `@google/genai`
