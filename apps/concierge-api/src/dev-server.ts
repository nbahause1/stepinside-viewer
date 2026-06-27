/**
 * Local Node dev server (node:http) on :8787.
 *
 * Reuses handleConcierge verbatim — the only differences from the Workers entry
 * are environment access (process.env) and the client-IP source (x-forwarded-for
 * / socket.remoteAddress). The knowledge base is read from the `knowledge/`
 * directory on disk.
 *
 * Run: npm run dev  (loads ANTHROPIC_API_KEY from .dev.vars via --env-file).
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateKnowledge } from './knowledge.js';
import type { KnowledgeBase } from './knowledge.js';
import { MemoryRateLimiter } from './ratelimit.js';
import { handleConcierge } from './core.js';
import { handleStaging } from './staging.js';
import { parseAllowedOrigins, resolveAllowOrigin, corsHeaders } from './cors.js';

const PORT = 8787;
const KNOWLEDGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
const PROPERTY_ID_RE = /^[a-z0-9-]{1,64}$/;
const cache = new Map<string, KnowledgeBase>();

async function loadKnowledge(propertyId: string): Promise<KnowledgeBase | null> {
  if (!PROPERTY_ID_RE.test(propertyId)) {
    return null;
  }
  const cached = cache.get(propertyId);
  if (cached) {
    return cached;
  }
  try {
    const raw = await readFile(join(KNOWLEDGE_DIR, `${propertyId}.json`), 'utf8');
    const kb = validateKnowledge(JSON.parse(raw));
    cache.set(propertyId, kb);
    return kb;
  } catch {
    return null;
  }
}

const rateLimiter = new MemoryRateLimiter();
// Image generation is far pricier than a chat turn -> its own tighter bucket.
const stagingRateLimiter = new MemoryRateLimiter(6, 5 * 60 * 1000);
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

function clientIpOf(req: IncomingMessage): string {
  // Dev only: key the rate-limiter on the real socket peer, NOT on the
  // client-supplied X-Forwarded-For header. There is no trusted proxy in front
  // of the dev server, so honouring XFF would let a client rotate the header and
  // mint a fresh rate-limit bucket per request (confirmed bypass). In prod the
  // Workers entry uses cf-connecting-ip (un-spoofable); a proxy-fronted Node/Vercel
  // deploy must read its platform's trusted client-IP header instead.
  return req.socket.remoteAddress ?? '';
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  cors: Record<string, string>,
  retryAfterSeconds?: number,
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...cors,
  };
  if (retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(retryAfterSeconds);
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const origin = req.headers['origin'];
    const originValue = Array.isArray(origin) ? origin[0] : (origin ?? null);
    const allowOrigin = resolveAllowOrigin(originValue, allowedOrigins);
    const cors = corsHeaders(allowOrigin);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { error: 'Method not allowed.' }, cors);
      return;
    }

    let rawBody: unknown;
    try {
      const text = await readBody(req);
      rawBody = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      send(res, 400, { error: 'Request body must be valid JSON.' }, cors);
      return;
    }

    const path = (req.url ?? '/').split('?')[0];

    // Route by path. /stage = virtual staging (Gemini); everything else falls
    // through to the concierge for backward compatibility.
    if (path === '/stage') {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        send(res, 500, { error: 'Server is not configured (missing GEMINI_API_KEY).' }, cors);
        return;
      }
      const result = await handleStaging(rawBody, {
        geminiApiKey,
        rateLimiter: stagingRateLimiter,
        clientIp: clientIpOf(req),
      });
      send(res, result.status, result.body, cors, result.retryAfterSeconds);
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      send(res, 500, { error: 'Server is not configured (missing ANTHROPIC_API_KEY).' }, cors);
      return;
    }

    const result = await handleConcierge(rawBody, {
      apiKey,
      loadKnowledge,
      rateLimiter,
      clientIp: clientIpOf(req),
    });

    send(res, result.status, result.body, cors, result.retryAfterSeconds);
  })().catch(() => {
    if (!res.headersSent) {
      // Mirror the success path's CORS headers so an unexpected error surfaces as
      // a readable 500 in the browser rather than an opaque CORS failure.
      const origin = req.headers['origin'];
      const originValue = Array.isArray(origin) ? origin[0] : (origin ?? null);
      const cors = corsHeaders(resolveAllowOrigin(originValue, allowedOrigins));
      res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Concierge dev server listening on http://localhost:${PORT}`);
});
