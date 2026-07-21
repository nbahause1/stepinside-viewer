/**
 * Cloudflare Workers entry point.
 *
 * Workers has no filesystem, so the knowledge base is bundled at build time via
 * a JSON import and validated once into an in-memory map. The client IP comes
 * from the `cf-connecting-ip` header; secrets come from `env`.
 *
 * Hardening (all optional, see README.md):
 *   - RATE_LIMIT_KV binding  -> real cross-isolate rate limiting (layered
 *     behind the free in-memory limiter) + the global daily spend caps on
 *     /stage and the concierge. Without it, limits fall back to a per-isolate
 *     in-memory limiter (weak) and the spend caps are DISABLED. All KV-backed
 *     limits are SOFT: on a KV error they log and fail open (see ratelimit.ts).
 *   - STAGE_DAILY_LIMIT      -> max /stage generations per UTC day (default 200).
 *   - CONCIERGE_DAILY_LIMIT  -> max concierge chat turns per UTC day (default 1000).
 *   - EVENTS_DAILY_LIMIT     -> max /events batches stored per UTC day (default 50000).
 *   - LEAD_DAILY_LIMIT       -> max leads stored per UTC day (default 200).
 *
 * Request-order hardening (this file): oversized bodies are rejected via
 * Content-Length and the per-IP rate limit runs BEFORE request.json(), so a
 * rate-limited client can't force multi-MB JSON parsing. The handlers then get
 * a pass-through limiter so nothing is double-counted.
 *   - STAGE_AUTH_TOKEN secret -> when set, /stage requires a matching
 *     `x-stage-token` header (401 otherwise). When unset, /stage stays open
 *     (frictionless demo), protected only by CORS + rate limits.
 */
import exampleFewo from '../knowledge/example-fewo.json';
import altbauEppendorf from '../knowledge/altbau-eppendorf.json';
// Reference furniture photos, bundled as raw bytes via the wrangler.toml Data
// rule (Workers has no filesystem). Keyed as `${style.dir}/${file}` below.
import set1Sofa from '../staging-refs/set1-vitra-klassiker/anagram-sofa.jpg';
import set1Eames from '../staging-refs/set1-vitra-klassiker/eames-lounge-chair.jpg';
import set1Noguchi from '../staging-refs/set1-vitra-klassiker/noguchi-coffee-table.jpg';
import set1Akari from '../staging-refs/set1-vitra-klassiker/vitra-akari-lamp.png';
import set2Usm from '../staging-refs/set2-usm-vitra-minimal/usm-haller-sideboard.jpg';
import set2Sofa from '../staging-refs/set2-usm-vitra-minimal/soft-modular-sofa.jpg';
import set2Dsw from '../staging-refs/set2-usm-vitra-minimal/eames-dsw-chair.jpg';
import set3Usm from '../staging-refs/set3-colour-pop/usm-haller-sideboard.jpg';
import set3Panton from '../staging-refs/set3-colour-pop/panton-chair.jpg';
import set3Dsw from '../staging-refs/set3-colour-pop/eames-dsw-chair.jpg';
import set3Sofa from '../staging-refs/set3-colour-pop/soft-modular-sofa.jpg';
import { Buffer } from 'node:buffer';
import { validateKnowledge } from './knowledge.js';
import type { KnowledgeBase } from './knowledge.js';
import { STAGING_STYLES } from './staging-prompt.js';
import type { StagingStyle } from './staging-prompt.js';
import type { ReferenceImage } from './staging.js';
import {
  MemoryRateLimiter,
  KvRateLimiter,
  KvDailyBudget,
  LayeredRateLimiter,
  PassThroughRateLimiter,
} from './ratelimit.js';
import type { KvLike, RateLimiter } from './ratelimit.js';
import { handleConcierge } from './core.js';
import { handleStaging } from './staging.js';
import { handleEvents, handleLead, handleReport } from './analytics.js';
import { tokensMatch } from './auth.js';
import type { D1Like } from './analytics.js';
import { parseAllowedOrigins, resolveAllowOrigin, corsHeaders } from './cors.js';

interface Env {
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY?: string;
  FAL_KEY?: string;
  STAGING_ENGINE?: string;
  /** 'off' disables the room-aware layout planner (staging-planner.ts). */
  STAGING_PLANNER?: string;
  /** Override for the layout plan model (default gemini-2.5-flash). */
  GEMINI_PLAN_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  /** KV namespace for shared rate limiting + the daily spend cap (wrangler.toml). */
  RATE_LIMIT_KV?: KvLike;
  /** Max /stage generations per UTC day across ALL clients. Default 200. */
  STAGE_DAILY_LIMIT?: string;
  /** Max concierge chat turns per UTC day across ALL clients. Default 1000. */
  CONCIERGE_DAILY_LIMIT?: string;
  /** Max /events batches stored per UTC day across ALL clients. Default 50000. */
  EVENTS_DAILY_LIMIT?: string;
  /** Max leads stored per UTC day across ALL clients. Default 200. */
  LEAD_DAILY_LIMIT?: string;
  /** Optional shared secret; when set, /stage requires the x-stage-token header. */
  STAGE_AUTH_TOKEN?: string;
  /**
   * Optional GLOBAL fallback inbound-webhook URL for the hot-lead alarm
   * (Flaggschiff 2): a stored lead is forwarded fire-and-forget so the broker
   * gets notified. A property with its own properties.lead_webhook_url overrides
   * this; this is the default for properties without one. Set as a secret (the
   * URL embeds a token):
   *   wrangler secret put GHL_HOTLEAD_WEBHOOK_URL
   */
  GHL_HOTLEAD_WEBHOOK_URL?: string;
  /**
   * Optional D1 database for anonymous analytics + leads (wrangler.toml).
   * When unbound, /events and /lead answer 202 and drop silently and
   * /report/* is a uniform 404 — the viewer never breaks without it.
   */
  ANALYTICS_DB?: D1Like;
}

// Validate + freeze the bundled KB once per isolate.
const KNOWLEDGE: Record<string, KnowledgeBase> = {
  'example-fewo': validateKnowledge(exampleFewo),
  'altbau-eppendorf': validateKnowledge(altbauEppendorf),
};

function loadKnowledge(propertyId: string): KnowledgeBase | null {
  return KNOWLEDGE[propertyId] ?? null;
}

// ---------------------------------------------------------------------------
// Bundled reference furniture (image-conditioning for /stage). Keyed by
// `${style.dir}/${file}` to mirror the on-disk layout the dev server reads.
// ---------------------------------------------------------------------------
const STAGING_REF_BYTES: Record<string, ArrayBuffer> = {
  'set1-vitra-klassiker/anagram-sofa.jpg': set1Sofa,
  'set1-vitra-klassiker/eames-lounge-chair.jpg': set1Eames,
  'set1-vitra-klassiker/noguchi-coffee-table.jpg': set1Noguchi,
  'set1-vitra-klassiker/vitra-akari-lamp.png': set1Akari,
  'set2-usm-vitra-minimal/usm-haller-sideboard.jpg': set2Usm,
  'set2-usm-vitra-minimal/soft-modular-sofa.jpg': set2Sofa,
  'set2-usm-vitra-minimal/eames-dsw-chair.jpg': set2Dsw,
  'set3-colour-pop/usm-haller-sideboard.jpg': set3Usm,
  'set3-colour-pop/panton-chair.jpg': set3Panton,
  'set3-colour-pop/eames-dsw-chair.jpg': set3Dsw,
  'set3-colour-pop/soft-modular-sofa.jpg': set3Sofa,
};

// Startup assert (once per isolate): the STAGING_REF_BYTES map is maintained
// BY HAND against style.refs in staging-prompt.ts — a typo would silently
// drop a style's reference photos (visibly worse furniture fidelity, no
// error anywhere). Make the mismatch loud in the logs instead.
for (const style of STAGING_STYLES) {
  for (const file of style.refs) {
    if (!STAGING_REF_BYTES[`${style.dir}/${file}`]) {
      console.error(`REF_MISSING style=${style.id} file=${style.dir}/${file} — update STAGING_REF_BYTES in worker.ts`);
    }
  }
}

// Base64 is what the Gemini/fal payloads need; encode lazily once per isolate.
const refBase64Cache = new Map<string, string>();

async function loadStyleReferences(style: StagingStyle): Promise<ReferenceImage[]> {
  const out: ReferenceImage[] = [];
  for (const file of style.refs) {
    const key = `${style.dir}/${file}`;
    const bytes = STAGING_REF_BYTES[key];
    if (!bytes) continue;   // skip a missing ref; the prompt still names the piece
    let base64 = refBase64Cache.get(key);
    if (!base64) {
      base64 = Buffer.from(bytes).toString('base64');
      refBase64Cache.set(key, base64);
    }
    out.push({
      mimeType: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      base64,
    });
  }
  return out;
}

// Rate-limit configuration, shared by the KV-backed and in-memory variants.
const CONCIERGE_LIMIT = 20;
const CONCIERGE_WINDOW_MS = 5 * 60 * 1000;
// Image generation is far pricier than a chat turn, so it gets its own,
// tighter bucket: 6 requests per 5 minutes per IP.
const STAGING_LIMIT = 6;
const STAGING_WINDOW_MS = 5 * 60 * 1000;
// Analytics beacons are cheap (D1 insert, no paid upstream), so the limit is
// generous. The lead form is a human action, but an open house on shared WiFi
// (NAT) puts many humans behind ONE IP — so the per-IP window is generous too;
// abuse is bounded by the global daily caps below instead.
const EVENTS_LIMIT = 60;
const EVENTS_WINDOW_MS = 5 * 60 * 1000;
const LEAD_LIMIT = 20;
const LEAD_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_STAGE_DAILY_LIMIT = 200;
const DEFAULT_CONCIERGE_DAILY_LIMIT = 1000;
// /events and /lead hit no paid upstream but DO write to D1 (and feed the
// Makler report), so they get global daily flood caps too: generous for
// beacons, tight for leads (200 real inquiries a day would be a luxury problem).
const DEFAULT_EVENTS_DAILY_LIMIT = 50_000;
const DEFAULT_LEAD_DAILY_LIMIT = 200;

// Hard ceilings on the request body, enforced via the Content-Length header
// BEFORE the body is parsed — so an oversized payload is rejected without ever
// buffering/parsing it. /stage legitimately carries a ~12M-char base64 frame
// (see staging-validation.ts); the concierge payload is a few KB of chat text.
const STAGE_MAX_BODY_BYTES = 13_000_000;
const CONCIERGE_MAX_BODY_BYTES = 256_000;
// A full /events batch (20 events x 500 chars data + envelope) is well under
// 32 KB; a /lead body (name/contact/message caps) fits in 16 KB.
const EVENTS_MAX_BODY_BYTES = 32_768;
const LEAD_MAX_BODY_BYTES = 16_384;

// In-memory fallback limiters (per isolate). NOTE: isolates don't share memory,
// so these under-count under load — bind RATE_LIMIT_KV for real limits.
const memoryConciergeLimiter = new MemoryRateLimiter(CONCIERGE_LIMIT, CONCIERGE_WINDOW_MS);
const memoryStagingLimiter = new MemoryRateLimiter(STAGING_LIMIT, STAGING_WINDOW_MS);
const memoryEventsLimiter = new MemoryRateLimiter(EVENTS_LIMIT, EVENTS_WINDOW_MS);
const memoryLeadLimiter = new MemoryRateLimiter(LEAD_LIMIT, LEAD_WINDOW_MS);
let warnedWeakLimits = false;

/**
 * Pick the limiters for this request. With KV bound, limiting is LAYERED: the
 * in-memory limiter runs first (free, catches same-isolate bursts that slip
 * through the racy KV get-then-put), the KV limiter second (cross-isolate).
 * Both must pass. Without KV only the weak in-memory limiter remains.
 */
function resolveLimiters(env: Env): {
  concierge: RateLimiter;
  staging: RateLimiter;
  events: RateLimiter;
  lead: RateLimiter;
} {
  if (env.RATE_LIMIT_KV) {
    // KvRateLimiter is stateless (all state lives in KV), so constructing per
    // request is free and always sees the current binding.
    return {
      concierge: new LayeredRateLimiter([
        memoryConciergeLimiter,
        new KvRateLimiter(env.RATE_LIMIT_KV, CONCIERGE_LIMIT, CONCIERGE_WINDOW_MS, 'rl:concierge'),
      ]),
      staging: new LayeredRateLimiter([
        memoryStagingLimiter,
        new KvRateLimiter(env.RATE_LIMIT_KV, STAGING_LIMIT, STAGING_WINDOW_MS, 'rl:stage'),
      ]),
      events: new LayeredRateLimiter([
        memoryEventsLimiter,
        new KvRateLimiter(env.RATE_LIMIT_KV, EVENTS_LIMIT, EVENTS_WINDOW_MS, 'rl:events'),
      ]),
      lead: new LayeredRateLimiter([
        memoryLeadLimiter,
        new KvRateLimiter(env.RATE_LIMIT_KV, LEAD_LIMIT, LEAD_WINDOW_MS, 'rl:lead'),
      ]),
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
  return {
    concierge: memoryConciergeLimiter,
    staging: memoryStagingLimiter,
    events: memoryEventsLimiter,
    lead: memoryLeadLimiter,
  };
}

/** Parse a daily-limit var (positive integer) with a safe default. */
function resolveDailyLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

// Anonymous events older than this are deleted by the nightly cron — they
// only feed the owner report's aggregates, and unbounded growth would make
// every report query a full-table scan (50k events/day cap x years).
// Leads are business records and are NOT auto-deleted.
const EVENTS_RETENTION_DAYS = 90;

export default {
  // Nightly maintenance (wrangler.toml [triggers]): prune old events.
  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (!env.ANALYTICS_DB) return;
    const cutoff = Date.now() - EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    try {
      const result = (await env.ANALYTICS_DB
        .prepare('DELETE FROM events WHERE ts < ?1')
        .bind(cutoff)
        .run()) as { meta?: unknown };
      console.log(`RETENTION events pruned older than ${EVENTS_RETENTION_DAYS}d`, JSON.stringify(result?.meta ?? {}));
    } catch (err) {
      console.error('RETENTION_FAILED', String(err).slice(0, 300));
    }
  },

  // ctx is declared structurally (like D1Like/KvLike) so the module compiles
  // without @cloudflare/workers-types.
  async fetch(request: Request, env: Env, ctx?: { waitUntil(task: Promise<unknown>): void }): Promise<Response> {
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get('origin');
    const allowOrigin = resolveAllowOrigin(origin, allowedOrigins);
    const cors = corsHeaders(allowOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /report/{propertyId}?token=... — the owner report. Token-gated
    // (constant-time compare in analytics.ts), uniform 404 on ANY mismatch.
    // Referrer-Policy matters: the secret token travels in the URL and must
    // never leak via the Referer header of a link click.
    if (request.method === 'GET') {
      // Uptime probe: cheap, unauthenticated, touches no paid upstream.
      // Reports whether the optional bindings are actually attached.
      if (path === '/healthz') {
        return jsonResponse(200, {
          ok: true,
          d1: !!env.ANALYTICS_DB,
          kv: !!env.RATE_LIMIT_KV,
        }, cors);
      }

      const reportMatch = path.match(/^\/report\/([a-z0-9-]{1,64})$/);
      if (reportMatch) {
        const report = await handleReport(
          reportMatch[1],
          url.searchParams.get('token') ?? '',
          env.ANALYTICS_DB,
        );
        return new Response(report.html, {
          status: report.status,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Robots-Tag': 'noindex',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
          },
        });
      }
      return jsonResponse(405, { error: 'Method not allowed.' }, cors);
    }

    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' }, cors);
    }

    const clientIp = request.headers.get('cf-connecting-ip') ?? '';

    const isStage = path === '/stage';
    const isEvents = path === '/events';
    const isLead = path === '/lead';

    // Optional /stage auth: reject before reading the (multi-MB image) body.
    if (isStage && env.STAGE_AUTH_TOKEN) {
      const token = request.headers.get('x-stage-token') ?? '';
      if (!tokensMatch(env.STAGE_AUTH_TOKEN, token)) {
        return jsonResponse(401, { error: 'Unauthorized.' }, cors);
      }
    }

    // Reject oversized bodies via Content-Length BEFORE parsing anything.
    // A body no valid request could have must not cost us a multi-MB parse.
    const maxBodyBytes = isStage
      ? STAGE_MAX_BODY_BYTES
      : isEvents
        ? EVENTS_MAX_BODY_BYTES
        : isLead
          ? LEAD_MAX_BODY_BYTES
          : CONCIERGE_MAX_BODY_BYTES;
    const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return jsonResponse(413, { error: 'Request body too large.' }, cors);
    }

    // Rate-limit BEFORE parsing the body: a limited client must not be able to
    // force JSON parsing of a multi-MB payload. The handlers receive a
    // pass-through limiter below so the request is counted exactly once.
    const limiters = resolveLimiters(env);
    const rateKey = clientIp || 'unknown';
    const limiter = isStage
      ? limiters.staging
      : isEvents
        ? limiters.events
        : isLead
          ? limiters.lead
          : limiters.concierge;
    const rate = await limiter.check(rateKey);
    if (!rate.allowed) {
      return jsonResponse(
        429,
        { error: 'Too many requests. Please slow down.' },
        cors,
        rate.retryAfterSeconds,
      );
    }
    const checkedLimiter = new PassThroughRateLimiter();

    // Read the body as a byte-counted stream: the Content-Length check above
    // is advisory only (a chunked request carries no Content-Length), so the
    // cap must also be enforced while actually reading.
    let rawBody: unknown;
    try {
      const reader = request.body?.getReader();
      if (!reader) {
        return jsonResponse(400, { error: 'Request body must be valid JSON.' }, cors);
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBodyBytes) {
          await reader.cancel();
          return jsonResponse(413, { error: 'Request body too large.' }, cors);
        }
        chunks.push(value);
      }
      const buf = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      rawBody = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      return jsonResponse(400, { error: 'Request body must be valid JSON.' }, cors);
    }

    // Route by path. /events and /lead are the (IP-free) analytics endpoints;
    // /stage = virtual staging (Gemini); everything else falls through to the
    // concierge for backward compatibility.
    // NOTE: clientIp was used for rate limiting ONLY — the analytics handlers
    // never receive it, so no IP can ever end up in the database.
    if (isEvents) {
      // Global daily flood cap (D1 writes + report noise). Over the cap the
      // handler answers 202 and DROPS — analytics must never break the viewer.
      const result = await handleEvents(
        rawBody,
        env.ANALYTICS_DB,
        env.RATE_LIMIT_KV
          ? new KvDailyBudget(
              env.RATE_LIMIT_KV,
              resolveDailyLimit(env.EVENTS_DAILY_LIMIT, DEFAULT_EVENTS_DAILY_LIMIT),
              'spend:events',
            )
          : undefined,
      );
      return jsonResponse(result.status, result.body, cors);
    }

    if (isLead) {
      // Global daily flood cap. Unlike /events a capped lead is surfaced as a
      // 429 with Retry-After — a lead matters, the client shows a message.
      const result = await handleLead(
        rawBody,
        env.ANALYTICS_DB,
        env.RATE_LIMIT_KV
          ? new KvDailyBudget(
              env.RATE_LIMIT_KV,
              resolveDailyLimit(env.LEAD_DAILY_LIMIT, DEFAULT_LEAD_DAILY_LIMIT),
              'spend:lead',
            )
          : undefined,
        // Always pass the forward: the destination is resolved per property
        // (properties.lead_webhook_url), with GHL_HOTLEAD_WEBHOOK_URL as the
        // optional global fallback. A property with its own webhook is notified
        // even when no global default is configured; with neither, forwardHotLead
        // simply does nothing.
        {
          webhookUrl: env.GHL_HOTLEAD_WEBHOOK_URL,
          waitUntil: ctx ? (task) => ctx.waitUntil(task) : undefined,
        },
      );
      return jsonResponse(result.status, result.body, cors, result.retryAfterSeconds);
    }

    if (isStage) {
      const engine = env.STAGING_ENGINE === 'fal' ? 'fal' as const : 'gemini' as const;
      if ((engine === 'gemini' && !env.GEMINI_API_KEY) || (engine === 'fal' && !env.FAL_KEY)) {
        return jsonResponse(500, { error: 'Server is not configured.' }, cors);
      }
      const result = await handleStaging(rawBody, {
        engine,
        geminiApiKey: env.GEMINI_API_KEY,
        falApiKey: env.FAL_KEY,
        enablePlanner: env.STAGING_PLANNER !== 'off',
        planModel: env.GEMINI_PLAN_MODEL,
        loadStyleReferences,
        rateLimiter: checkedLimiter,
        clientIp,
        // Kill-switch against cost abuse: hard daily generation budget, shared
        // across all visitors. Only enforceable with a shared store (KV).
        dailyBudget: env.RATE_LIMIT_KV
          ? new KvDailyBudget(
              env.RATE_LIMIT_KV,
              resolveDailyLimit(env.STAGE_DAILY_LIMIT, DEFAULT_STAGE_DAILY_LIMIT),
            )
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
      rateLimiter: checkedLimiter,
      clientIp,
      // The concierge hits a paid Anthropic call, so it gets its own daily
      // budget (separate KV key prefix) — /stage's cap must not be its only one.
      dailyBudget: env.RATE_LIMIT_KV
        ? new KvDailyBudget(
            env.RATE_LIMIT_KV,
            resolveDailyLimit(env.CONCIERGE_DAILY_LIMIT, DEFAULT_CONCIERGE_DAILY_LIMIT),
            'spend:concierge',
          )
        : undefined,
    });

    return jsonResponse(result.status, result.body, cors, result.retryAfterSeconds);
  },
};
