/**
 * Cloudflare Workers entry point.
 *
 * Workers has no filesystem, so the knowledge base is bundled at build time via
 * a JSON import and validated once into an in-memory map. The client IP comes
 * from the `cf-connecting-ip` header; secrets come from `env`.
 */
import exampleFewo from '../knowledge/example-fewo.json';
import { validateKnowledge } from './knowledge.js';
import type { KnowledgeBase } from './knowledge.js';
import { MemoryRateLimiter } from './ratelimit.js';
import { handleConcierge } from './core.js';
import { handleStaging } from './staging.js';
import { parseAllowedOrigins, resolveAllowOrigin, corsHeaders } from './cors.js';

interface Env {
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

// Validate + freeze the bundled KB once per isolate.
const KNOWLEDGE: Record<string, KnowledgeBase> = {
  'example-fewo': validateKnowledge(exampleFewo),
};

function loadKnowledge(propertyId: string): KnowledgeBase | null {
  return KNOWLEDGE[propertyId] ?? null;
}

// One limiter per isolate. NOTE: isolates don't share memory; for real
// production abuse-protection back this with KvRateLimiter (see ratelimit.ts).
const rateLimiter = new MemoryRateLimiter();
// Image generation is far pricier than a chat turn, so it gets its own,
// tighter bucket: 6 requests per 5 minutes per IP.
const stagingRateLimiter = new MemoryRateLimiter(6, 5 * 60 * 1000);

function jsonResponse(
  status: number,
  body: unknown,
  cors: Record<string, string>,
  retryAfterSeconds?: number,
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...cors,
  };
  if (retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(retryAfterSeconds);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get('origin');
    const allowOrigin = resolveAllowOrigin(origin, allowedOrigins);
    const cors = corsHeaders(allowOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' }, cors);
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonResponse(400, { error: 'Request body must be valid JSON.' }, cors);
    }

    const clientIp = request.headers.get('cf-connecting-ip') ?? '';
    const path = new URL(request.url).pathname;

    // Route by path. /stage = virtual staging (Gemini); everything else falls
    // through to the concierge for backward compatibility.
    if (path === '/stage') {
      if (!env.GEMINI_API_KEY) {
        return jsonResponse(500, { error: 'Server is not configured.' }, cors);
      }
      const result = await handleStaging(rawBody, {
        geminiApiKey: env.GEMINI_API_KEY,
        rateLimiter: stagingRateLimiter,
        clientIp,
      });
      return jsonResponse(result.status, result.body, cors, result.retryAfterSeconds);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(500, { error: 'Server is not configured.' }, cors);
    }

    const result = await handleConcierge(rawBody, {
      apiKey: env.ANTHROPIC_API_KEY,
      loadKnowledge,
      rateLimiter,
      clientIp,
    });

    return jsonResponse(result.status, result.body, cors, result.retryAfterSeconds);
  },
};
