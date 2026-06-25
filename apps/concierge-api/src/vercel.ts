/**
 * Vercel adapter (thin).
 *
 * Uses process.env for secrets and reads the client IP from `x-forwarded-for`.
 * The knowledge base is read from the filesystem (Vercel functions ship the
 * `knowledge/` directory as part of the deployment bundle).
 *
 * Exported as a default request handler compatible with Vercel's Node runtime
 * (`export default function handler(req, res)`). Typed structurally so this file
 * has no dependency on `@vercel/node` types.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateKnowledge } from './knowledge.js';
import type { KnowledgeBase } from './knowledge.js';
import { MemoryRateLimiter } from './ratelimit.js';
import { handleConcierge } from './core.js';
import { parseAllowedOrigins, resolveAllowOrigin, corsHeaders } from './cors.js';

interface VercelRequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
  on(event: string, listener: (chunk: unknown) => void): void;
}

interface VercelResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponseLike;
  json(body: unknown): void;
  end(): void;
}

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

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function clientIpOf(req: VercelRequestLike): string {
  // Use Vercel's platform-set client-IP header, which the edge overwrites on every
  // request — the client cannot spoof it. Do NOT trust the leftmost token of a raw
  // X-Forwarded-For: a client can prepend values there to rotate the rate-limit
  // bucket and bypass the per-IP limiter (confirmed bypass on the naive approach).
  const realIp = firstHeader(req.headers['x-real-ip']);
  if (realIp) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress ?? '';
}

async function readJsonBody(req: VercelRequestLike): Promise<unknown> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body);
    }
    return req.body;
  }
  // Fall back to streaming the raw body if Vercel hasn't pre-parsed it.
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: unknown) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve());
    req.on('error', (err: unknown) => reject(err));
  });
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? JSON.parse(text) : {};
}

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike,
): Promise<void> {
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  const allowOrigin = resolveAllowOrigin(firstHeader(req.headers['origin']), allowedOrigins);
  const cors = corsHeaders(allowOrigin);
  for (const [name, value] of Object.entries(cors)) {
    res.setHeader(name, value);
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is not configured.' });
    return;
  }

  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: 'Request body must be valid JSON.' });
    return;
  }

  const result = await handleConcierge(rawBody, {
    apiKey,
    loadKnowledge,
    rateLimiter,
    clientIp: clientIpOf(req),
  });

  if (result.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
  }
  res.status(result.status).json(result.body);
}
