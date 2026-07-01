/**
 * Rate limiting.
 *
 * MemoryRateLimiter is a working sliding-window limiter suitable for the local
 * dev server and any single-instance deployment. On Cloudflare Workers, isolates
 * do NOT share memory, so a production deployment must back the limiter with KV
 * (KvRateLimiter below) or a Durable Object. KvDailyBudget adds a global daily
 * spend cap on top — the kill-switch against cost abuse on the paid endpoints.
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

    const raw = await this.kv.get(kvKey);
    const count = raw ? Number.parseInt(raw, 10) || 0 : 0;

    if (count >= this.limit) {
      const windowEnd = (windowIndex + 1) * this.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    await this.kv.put(kvKey, String(count + 1), {
      // KV minimum TTL is 60s; keep the counter alive slightly past window end.
      expirationTtl: Math.max(60, Math.ceil(this.windowMs / 1000) + 60),
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Global daily spend cap ("kill-switch") backed by KV.
 *
 * Maintains one counter per UTC day (`spend:YYYY-MM-DD`, TTL 2 days) shared by
 * ALL clients. Once `limit` generations have been consumed, every further
 * request is rejected until UTC midnight — this bounds the worst-case daily
 * cost of the paid /stage endpoint no matter how distributed an abuser is.
 *
 * Same softness caveat as KvRateLimiter (KV get/put races can overshoot by a
 * few requests under a burst), which is acceptable for a cost ceiling.
 */
export class KvDailyBudget {
  private readonly kv: KvLike;
  private readonly limit: number;

  constructor(kv: KvLike, limit: number) {
    this.kv = kv;
    this.limit = limit;
  }

  /** Consume one unit of today's budget; disallow once the cap is reached. */
  async consume(): Promise<RateLimitResult> {
    const now = new Date();
    const day = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const key = `spend:${day}`;

    const raw = await this.kv.get(key);
    const used = raw ? Number.parseInt(raw, 10) || 0 : 0;

    if (used >= this.limit) {
      const nextMidnightUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      const retryAfterSeconds = Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    await this.kv.put(key, String(used + 1), { expirationTtl: 2 * 24 * 60 * 60 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
