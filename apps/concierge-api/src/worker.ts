/**
 * Cloudflare Workers entry point.
 *
 * Workers has no filesystem, so the knowledge base is bundled at build time via
 * a JSON import and validated once into an in-memory map. The client IP comes
 * from the `cf-connecting-ip` header; secrets come from `env`.
 *
 * Hardening (all optional, see README.md):
 *   - RATE_LIMIT_KV binding  -> real cross-isolate rate limiting + the global
 *     daily spend cap on /stage. Without it, limits fall back to a per-isolate
 *     in-memory limiter (weak) and the spend cap is DISABLED.
 *   - STAGE_DAILY_LIMIT      -> max /stage generations per UTC day (default 200).
 *   - STAGE_AUTH_TOKEN secret -> when set, /stage requires a matching
 *     `x-stage-token` header (401 otherwise). When unset, /stage stays open
 *     (frictionless demo), protected only by CORS + rate limits.
 */
import exampleFewo from '../knowledge/example-fewo.json';
import { validateKnowledge } from './knowledge.js';
import type { KnowledgeBase } from './knowledge.js';
import { MemoryRateLimiter, KvRateLimiter, KvDailyBudget } from './ratelimit.js';
import type { KvLike, RateLimiter } from './ratelimit.js';
import { handleConcierge } from './core.js';
import { handleStaging } from './staging.js';
import { parseAllowedOrigins, resolveAllowOrigin, corsHeaders } from './cors.js';

interface Env {
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  /** KV namespace for shared rate limiting + the daily spend cap (wrangler.toml). */
  RATE_LIMIT_KV?: KvLike;
  /** Max /stage generations per UTC day across ALL clients. Default 200. */
  STAGE_DAILY_LIMIT?: string;
  /** Optional shared secret; when set, /stage requires the x-stage-token header. */
  STAGE_AUTH_TOKEN?: string;
}

// Validate + freeze the bundled KB once per isolate.
const KNOWLEDGE: Record<string, KnowledgeBase> = {
  'example-fewo': validateKnowledge(exampleFewo),
};

function loadKnowledge(propertyId: string): KnowledgeBase | null {
  return KNOWLEDGE[propertyId] ?? null;
}

// Rate-limit configuration, shared by the KV-backed and in-memory variants.
const CONCIERGE_LIMIT = 20;
const CONCIERGE_WINDOW_MS = 5 * 60 * 1000;
// Image generation is far pricier than a chat turn, so it gets its own,
// tighter bucket: 6 requests per 5 minutes per IP.
const STAGING_LIMIT = 6;
const STAGING_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_STAGE_DAILY_LIMIT = 200;

// In-memory fallback limiters (per isolate). NOTE: isolates don't share memory,
// so these under-count under load — bind RATE_LIMIT_KV for real limits.
const memoryConciergeLimiter = new MemoryRateLimiter(CONCIERGE_LIMIT, CONCIERGE_WINDOW_MS);
const memoryStagingLimiter = new MemoryRateLimiter(STAGING_LIMIT, STAGING_WINDOW_MS);
let warnedWeakLimits = false;

/** Pick KV-backed limiters when the binding exists, else the weak in-memory ones. */
function resolveLimiters(env: Env): { concierge: RateLimiter; staging: RateLimiter } {
  if (env.RATE_LIMIT_KV) {
    // KvRateLimiter is stateless (all state lives in KV), so constructing per
    // request is free and always sees the current binding.
    return {
      concierge: new KvRateLimiter(env.RATE_LIMIT_KV, CONCIERGE_LIMIT, CONCIERGE_WINDOW_MS, 'rl:concierge'),
      staging: new KvRateLimiter(env.RATE_LIMIT_KV, STAGING_LIMIT, STAGING_WINDOW_MS, 'rl:stage'),
    };
  }
  if (!warnedWeakLimits) {
    warnedWeakLimits = true;
    console.warn(
      '[worker] RATE_LIMIT_KV is not bound: falling back to per-isolate in-memory rate limits ' +
      '(weak — isolates do not share memory) and the /stage daily spend cap is DISABLED. ' +
      'Create the namespace and uncomment kv_namespaces in wrangler.toml for real protection.',
    );
  }
  return { concierge: memoryConciergeLimiter, staging: memoryStagingLimiter };
}

/** Parse STAGE_DAILY_LIMIT (positive integer) with a safe default. */
function resolveDailyLimit(env: Env): number {
  const parsed = Number.parseInt(env.STAGE_DAILY_LIMIT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STAGE_DAILY_LIMIT;
}

/** Constant-time token comparison (no early exit on the first differing byte). */
function tokensMatch(expected: string, provided: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(provided);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

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

    const clientIp = request.headers.get('cf-connecting-ip') ?? '';
    const path = new URL(request.url).pathname;

    // Optional /stage auth: reject before reading the (multi-MB image) body.
    if (path === '/stage' && env.STAGE_AUTH_TOKEN) {
      const token = request.headers.get('x-stage-token') ?? '';
      if (!tokensMatch(env.STAGE_AUTH_TOKEN, token)) {
        return jsonResponse(401, { error: 'Unauthorized.' }, cors);
      }
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonResponse(400, { error: 'Request body must be valid JSON.' }, cors);
    }

    const limiters = resolveLimiters(env);

    // Route by path. /stage = virtual staging (Gemini); everything else falls
    // through to the concierge for backward compatibility.
    if (path === '/stage') {
      if (!env.GEMINI_API_KEY) {
        return jsonResponse(500, { error: 'Server is not configured.' }, cors);
      }
      const result = await handleStaging(rawBody, {
        geminiApiKey: env.GEMINI_API_KEY,
        rateLimiter: limiters.staging,
        clientIp,
        // Kill-switch against cost abuse: hard daily generation budget, shared
        // across all visitors. Only enforceable with a shared store (KV).
        dailyBudget: env.RATE_LIMIT_KV
          ? new KvDailyBudget(env.RATE_LIMIT_KV, resolveDailyLimit(env))
          : undefined,
      });
      return jsonResponse(result.status, result.body, cors, result.retryAfterSeconds);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(500, { error: 'Server is not configured.' }, cors);
    }

    const result = await handleConcierge(rawBody, {
      apiKey: env.ANTHROPIC_API_KEY,
      loadKnowledge,
      rateLimiter: limiters.concierge,
      clientIp,
    });

    return jsonResponse(result.status, result.body, cors, result.retryAfterSeconds);
  },
};
