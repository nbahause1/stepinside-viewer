/**
 * Rate limiting.
 *
 * MemoryRateLimiter is a working sliding-window limiter suitable for the local
 * dev server and any single-instance deployment. On Cloudflare Workers, isolates
 * do NOT share memory, so a production deployment must back the limiter with KV
 * or a Durable Object — see the documented KvRateLimiter stub at the bottom.
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
 * Production stub for Cloudflare Workers.
 *
 * Workers isolates don't share memory, so a per-isolate Map under-counts under
 * load. Back the limiter with Workers KV (eventually consistent, fine for a soft
 * abuse limit) or a Durable Object (strongly consistent) instead.
 *
 * Wire-up sketch (KV):
 *   1. Add to wrangler.toml:
 *        [[kv_namespaces]]
 *        binding = "RATE_LIMIT"
 *        id = "<namespace-id>"
 *   2. Pass `env.RATE_LIMIT` into this limiter from worker.ts.
 *   3. Store a JSON array of hit timestamps per key with a TTL of `windowMs`,
 *      prune on read exactly like MemoryRateLimiter, and write it back.
 *
 * The implementation below is intentionally inert (it does not enforce limits)
 * and should not be used in production until the KV read/write is filled in.
 * It is provided so the wiring contract is explicit.
 */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export class KvRateLimiter implements RateLimiter {
  private readonly kv: KvLike;
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(kv: KvLike, limit: number = DEFAULT_LIMIT, windowMs: number = DEFAULT_WINDOW_MS) {
    this.kv = kv;
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const raw = await this.kv.get(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const timestamps = Array.isArray(parsed)
      ? parsed.filter((t): t is number => typeof t === 'number' && t > windowStart)
      : [];

    if (timestamps.length >= this.limit) {
      const oldest = timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    timestamps.push(now);
    await this.kv.put(key, JSON.stringify(timestamps), {
      expirationTtl: Math.ceil(this.windowMs / 1000),
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
