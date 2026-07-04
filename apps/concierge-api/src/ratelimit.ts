/**
 * Rate limiting.
 *
 * MemoryRateLimiter is a working sliding-window limiter suitable for the local
 * dev server and any single-instance deployment. On Cloudflare Workers, isolates
 * do NOT share memory, so a production deployment must back the limiter with KV
 * (KvRateLimiter below) or a Durable Object. KvDailyBudget adds a global daily
 * spend cap on top — the kill-switch against cost abuse on the paid endpoints.
 *
 * SOFT LIMITS: both KV-backed classes treat KV I/O failures as non-fatal. A KV
 * error (e.g. the 1-write/sec-per-key cap on a hot counter key) logs a warning
 * and FAILS OPEN — the request is allowed rather than 500ing every visitor.
 * Combined with KV's eventual consistency this means limits can overshoot under
 * bursts or KV outages; they are abuse/cost ceilings, not billing meters. Use a
 * Durable Object if you ever need strict counting.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry (only meaningful when !allowed). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Record a hit for `key` and report whether it is within the limit. */
  check(key: string): Promise<RateLimitResult>;
}

/**
 * A limiter that always allows. Handed into the core handlers by entry points
 * that already ran the real rate-limit check BEFORE parsing the request body
 * (see worker.ts), so the handler's own check never double-counts a request.
 */
export class PassThroughRateLimiter implements RateLimiter {
  check(): Promise<RateLimitResult> {
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }
}

/**
 * Runs several limiters in order; ALL must allow. The first denial wins (later
 * layers are then not consulted and record no hit). Used to layer the free
 * in-memory limiter (catches same-isolate bursts, including the KV get/put race)
 * in front of the KV limiter (cross-isolate, eventually consistent).
 */
export class LayeredRateLimiter implements RateLimiter {
  private readonly layers: RateLimiter[];

  constructor(layers: RateLimiter[]) {
    this.layers = layers;
  }

  async check(key: string): Promise<RateLimitResult> {
    for (const layer of this.layers) {
      const result = await layer.check(key);
      if (!result.allowed) {
        return result;
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Sliding-window in-memory limiter. Keeps recent hit timestamps per key and
 * prunes entries that fall outside the window on each check. Single-instance
 * only (memory is per-process / per-isolate).
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(limit: number = DEFAULT_LIMIT, windowMs: number = DEFAULT_WINDOW_MS) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const existing = this.hits.get(key);
    const recent = existing ? existing.filter((t) => t > windowStart) : [];

    if (recent.length >= this.limit) {
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      // Persist the pruned list so memory doesn't grow unbounded.
      this.hits.set(key, recent);
      this.pruneOccasionally(windowStart);
      return Promise.resolve({ allowed: false, retryAfterSeconds });
    }

    recent.push(now);
    this.hits.set(key, recent);
    this.pruneOccasionally(windowStart);
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }

  /** Drop fully-expired keys so the map doesn't leak across many clients. */
  private pruneOccasionally(windowStart: number): void {
    // Cheap guard: only sweep when the map grows past a threshold.
    if (this.hits.size < 1000) {
      return;
    }
    for (const [key, timestamps] of this.hits) {
      const live = timestamps.filter((t) => t > windowStart);
      if (live.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, live);
      }
    }
  }
}

/**
 * Minimal structural slice of a Workers KV namespace binding. Declared locally
 * so the limiter stays testable and the non-Workers entry points don't need
 * `@cloudflare/workers-types` at their call sites.
 */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * KV-backed fixed-window limiter for Cloudflare Workers.
 *
 * Workers isolates don't share memory, so MemoryRateLimiter under-counts under
 * load (each isolate keeps its own Map). This limiter stores one small counter
 * per key per window in KV, so all isolates and colos see (eventually) the same
 * count.
 *
 * Design notes:
 *   - Fixed window: the counter key embeds the window index
 *     (`<prefix>:<key>:<floor(now / windowMs)>`), so windows roll over without
 *     any pruning logic and expired counters vanish via `expirationTtl`.
 *   - KV `get`/`put` is not atomic and is eventually consistent, so concurrent
 *     requests can slightly overshoot the limit. That is fine here: this is a
 *     soft abuse/cost limit, not a billing meter. For strict counting use a
 *     Durable Object instead.
 *   - KV enforces a minimum `expirationTtl` of 60 seconds; we keep counters a
 *     minute past the window end, which is harmless (old windows are never
 *     read again).
 */
export class KvRateLimiter implements RateLimiter {
  private readonly kv: KvLike;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly prefix: string;

  constructor(
    kv: KvLike,
    limit: number = DEFAULT_LIMIT,
    windowMs: number = DEFAULT_WINDOW_MS,
    prefix: string = 'rl',
  ) {
    this.kv = kv;
    this.limit = limit;
    this.windowMs = windowMs;
    this.prefix = prefix;
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowIndex = Math.floor(now / this.windowMs);
    const kvKey = `${this.prefix}:${key}:${windowIndex}`;

    let count = 0;
    try {
      const raw = await this.kv.get(kvKey);
      count = raw ? Number.parseInt(raw, 10) || 0 : 0;
    } catch (err) {
      // Soft limit: a KV read failure must not 500 the endpoint. FAIL OPEN.
      console.warn(`[ratelimit] KV get failed for ${kvKey}, failing open:`, String(err));
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (count >= this.limit) {
      const windowEnd = (windowIndex + 1) * this.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    try {
      await this.kv.put(kvKey, String(count + 1), {
        // KV minimum TTL is 60s; keep the counter alive slightly past window end.
        expirationTtl: Math.max(60, Math.ceil(this.windowMs / 1000) + 60),
      });
    } catch (err) {
      // Soft limit: e.g. KV's 1-write/sec-per-key cap under a burst. The hit is
      // simply not recorded; the request still goes through. FAIL OPEN.
      console.warn(`[ratelimit] KV put failed for ${kvKey}, failing open:`, String(err));
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Global daily spend cap ("kill-switch") backed by KV.
 *
 * Maintains one counter per UTC day (`<prefix>:YYYY-MM-DD`, TTL 2 days) shared
 * by ALL clients. Once `limit` calls have been consumed, every further request
 * is rejected until UTC midnight — this bounds the worst-case daily cost of a
 * paid endpoint (or D1 flooding of an analytics endpoint) no matter how
 * distributed an abuser is. Each capped endpoint gets its own prefix (`spend`
 * for /stage, `spend:concierge`, `spend:events`, `spend:lead`) so one budget
 * can't be drained through another.
 *
 * SOFT LIMIT: same caveats as KvRateLimiter — KV get/put races can overshoot
 * by a few requests under a burst, and any KV I/O error (e.g. the
 * 1-write/sec-per-key cap on this deliberately hot key) logs a warning and
 * FAILS OPEN instead of 500ing the request. Acceptable for a cost ceiling.
 */
export class KvDailyBudget {
  private readonly kv: KvLike;
  private readonly limit: number;
  private readonly prefix: string;

  constructor(kv: KvLike, limit: number, prefix: string = 'spend') {
    this.kv = kv;
    this.limit = limit;
    this.prefix = prefix;
  }

  /** Consume one unit of today's budget; disallow once the cap is reached. */
  async consume(): Promise<RateLimitResult> {
    const now = new Date();
    const day = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const key = `${this.prefix}:${day}`;

    let used = 0;
    try {
      const raw = await this.kv.get(key);
      used = raw ? Number.parseInt(raw, 10) || 0 : 0;
    } catch (err) {
      // Soft limit: a KV read failure must not 500 the endpoint. FAIL OPEN.
      console.warn(`[budget] KV get failed for ${key}, failing open:`, String(err));
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (used >= this.limit) {
      const nextMidnightUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      const retryAfterSeconds = Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    try {
      await this.kv.put(key, String(used + 1), { expirationTtl: 2 * 24 * 60 * 60 });
    } catch (err) {
      // Soft limit: this key takes every request of the day, so KV's
      // 1-write/sec-per-key cap WILL trip under load. Don't record, don't 500.
      console.warn(`[budget] KV put failed for ${key}, failing open:`, String(err));
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
