/**
 * Rate limiting (ratelimit.ts): window rollover of the in-memory limiter,
 * the FAIL-OPEN contract of the KV-backed classes when KV I/O throws, and
 * the daily budget's retry-until-UTC-midnight + BUDGET_EXHAUSTED alarm line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MemoryRateLimiter,
  KvRateLimiter,
  KvDailyBudget,
  PassThroughRateLimiter,
  LayeredRateLimiter,
} from '../src/ratelimit.js';
import type { KvLike } from '../src/ratelimit.js';

/** A KV fake whose get/put both throw — simulates a KV outage / write cap. */
function throwingKv(): KvLike {
  return {
    get: async () => {
      throw new Error('KV unavailable');
    },
    put: async () => {
      throw new Error('KV write cap');
    },
  };
}

/** A working in-memory KV fake. */
function memoryKv(initial: Record<string, string> = {}): KvLike & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MemoryRateLimiter', () => {
  it('allows up to the limit, then denies with a retry hint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    const limiter = new MemoryRateLimiter(3, 60_000);

    for (let i = 0; i < 3; i++) {
      expect((await limiter.check('ip-1')).allowed).toBe(true);
    }
    const denied = await limiter.check('ip-1');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('rolls the window over: hits expire and the key is allowed again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    const limiter = new MemoryRateLimiter(2, 60_000);

    await limiter.check('ip-1');
    await limiter.check('ip-1');
    expect((await limiter.check('ip-1')).allowed).toBe(false);

    // Just before the window edge: still denied.
    vi.setSystemTime(new Date('2026-07-04T12:00:59.999Z'));
    expect((await limiter.check('ip-1')).allowed).toBe(false);

    // Past the window: the old hits fall out, the key is fresh again.
    vi.setSystemTime(new Date('2026-07-04T12:01:00.001Z'));
    expect((await limiter.check('ip-1')).allowed).toBe(true);
  });

  it('tracks keys independently', async () => {
    const limiter = new MemoryRateLimiter(1, 60_000);
    expect((await limiter.check('ip-1')).allowed).toBe(true);
    expect((await limiter.check('ip-2')).allowed).toBe(true);
    expect((await limiter.check('ip-1')).allowed).toBe(false);
  });
});

describe('KvRateLimiter', () => {
  it('counts across checks via KV and denies past the limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    const kv = memoryKv();
    const limiter = new KvRateLimiter(kv, 2, 60_000);

    expect((await limiter.check('ip-1')).allowed).toBe(true);
    expect((await limiter.check('ip-1')).allowed).toBe(true);
    const denied = await limiter.check('ip-1');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('FAILS OPEN when KV get throws', async () => {
    const limiter = new KvRateLimiter(throwingKv(), 0, 60_000); // limit 0: would deny if KV worked
    const result = await limiter.check('ip-1');
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('failing open'),
      expect.anything(),
    );
  });

  it('FAILS OPEN when only KV put throws (hit simply not recorded)', async () => {
    const kv = memoryKv();
    kv.put = async () => {
      throw new Error('1 write/sec cap');
    };
    const limiter = new KvRateLimiter(kv, 5, 60_000);
    const result = await limiter.check('ip-1');
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});

describe('KvDailyBudget', () => {
  it('consumes budget units and stores the counter under the UTC-day key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T18:00:00Z'));
    const kv = memoryKv();
    const budget = new KvDailyBudget(kv, 10, 'spend:test');

    const result = await budget.consume();
    expect(result.allowed).toBe(true);
    expect(kv.store.get('spend:test:2026-07-04')).toBe('1');
  });

  it('denies once the limit is reached, with retryAfterSeconds until UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T18:00:00Z')); // 6h to UTC midnight
    const kv = memoryKv({ 'spend:2026-07-04': '10' });
    const budget = new KvDailyBudget(kv, 10);

    const result = await budget.consume();
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(6 * 60 * 60);
  });

  it('logs the BUDGET_EXHAUSTED alert line when denying', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T18:00:00Z'));
    const kv = memoryKv({ 'spend:concierge:2026-07-04': '25' });
    const budget = new KvDailyBudget(kv, 25, 'spend:concierge');

    await budget.consume();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('BUDGET_EXHAUSTED spend:concierge'),
    );
  });

  it('does NOT log BUDGET_EXHAUSTED while under the limit', async () => {
    const budget = new KvDailyBudget(memoryKv(), 5);
    await budget.consume();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('FAILS OPEN when KV get throws — even at limit 0', async () => {
    const budget = new KvDailyBudget(throwingKv(), 0);
    const result = await budget.consume();
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(console.error).not.toHaveBeenCalled(); // outage is a warning, not the budget alarm
  });

  it('FAILS OPEN when only KV put throws', async () => {
    const kv = memoryKv();
    kv.put = async () => {
      throw new Error('KV write cap');
    };
    const budget = new KvDailyBudget(kv, 5);
    const result = await budget.consume();
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});

describe('composition helpers', () => {
  it('PassThroughRateLimiter always allows', async () => {
    expect(await new PassThroughRateLimiter().check()).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('LayeredRateLimiter: the first denial wins and later layers are not consulted', async () => {
    const deny = { check: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 42 }) };
    const never = { check: vi.fn() };
    const layered = new LayeredRateLimiter([deny, never]);
    const result = await layered.check('k');
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 42 });
    expect(never.check).not.toHaveBeenCalled();
  });
});
