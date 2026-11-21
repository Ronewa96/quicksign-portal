import 'dotenv/config'; // loads .env (SMTP and API keys) before anything reads process.env
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import { attachUser, requireAuth, createAuthRouter, seedDevUser } from './server/auth';
import { createConvertRouter } from './server/convert';
import { createRequestsRouter, createContactsRouter, createPublicSignRouter } from './server/requests';
import { createAiRouter, isAiConfigured } from './server/ai';
import { isEmailConfigured } from './server/mailer';
import { readLocation } from './server/location';

const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3000', 10);

async function startServer() {
  const app = express();
  // Behind the HTTPS proxy (Caddy on the same machine / Docker network): use the visitor's real IP
  // and protocol for rate limiting and email links. Only proxies on private addresses are trusted.
  app.set('trust proxy', 'loopback, uniquelocal');

  // Basic middleware
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Authentication: resolve session cookie, expose auth routes, guard protected APIs
  seedDevUser();
  app.use(attachUser);
  app.use('/api/auth', createAuthRouter());
  app.use(['/api/ai', '/api/convert', '/api/audit'], requireAuth);

  // Layout-preserving file conversion (LibreOffice): /api/convert/status, /api/convert/file
  app.use('/api/convert', createConvertRouter());

  // AI document review and Q&A (Google Gemini, with a basic keyword check as fallback)
  app.use('/api/ai', createAiRouter());

  // Sending documents to other people for signing, remembered contacts, and email notifications
  app.use('/api/requests', requireAuth, createRequestsRouter());
  app.use('/api/contacts', requireAuth, createContactsRouter());
  // Public: signers open their private link without an account
  app.use('/api/sign', createPublicSignRouter());
  app.get('/api/email/status', requireAuth, (_req, res) => res.json({ configured: isEmailConfigured() }));

  // Health check & status
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      aiConfigured: isAiConfigured(),
      version: '2.4.0',
    });
  });

  // Signature record: transaction ID and SHA-256 fingerprint
  app.post('/api/audit/seal', async (req, res) => {
    try {
      const { documentId, documentTitle, signerName, signerEmail, signatureData } = req.body;
      const location = await readLocation(req.body?.location, req.ip || '');

      const rawPayload = `${documentId || ''}:${signerName || ''}:${signerEmail || ''}:${Date.now()}:${signatureData || ''}`;
      const sha256Hash = crypto.createHash('sha256').update(rawPayload).digest('hex');
      const txId = `QS-TX-${sha256Hash.slice(0, 8).toUpperCase()}-${new Date().getFullYear()}`;

      res.json({
        success: true,
        transactionId: txId,
        sha256Hash,
        timestamp: new Date().toISOString(),
        verified: true,
        verificationUrl: `/audit?tx=${txId}`,
        ipAddress: req.ip || 'unknown',
        location,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to record signature' });
    }
  });

  // Unknown API routes get a clear JSON answer instead of the web page
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Last-resort error handler: log the details, never send them to the browser
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled API error:', err);
    if (res.headersSent) return;
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'This upload is too large.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read.' });
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  // Mount Vite or static server
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[QuickSign Server] Online at http://0.0.0.0:${PORT} (mode: ${isProduction ? 'prod' : 'dev'})`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup failure:', err);
  process.exit(1);
});
