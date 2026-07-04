/**
 * Authorization behaviour of the owner report (handleReport in analytics.ts).
 *
 * Security contract under test: EVERY authorization failure — no database,
 * unknown property, empty token, wrong token, property without a configured
 * token — must yield the exact same 404 response, so the endpoint never
 * leaks whether a property exists or how close a token guess was.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleReport } from '../src/analytics.js';
import type { D1Like, D1StatementLike } from '../src/analytics.js';

const TOKEN = 'owner-secret-token-1234';

/**
 * Fake D1 that serves the property lookup plus all report aggregation
 * queries. Routing is by SQL text, mirroring how collectReportData
 * distinguishes its statements.
 */
function fakeDb(options: {
  property?: Record<string, unknown> | null;
  surveyRows?: Record<string, unknown>[];
}): D1Like {
  const makeStatement = (query: string): D1StatementLike => {
    const stmt: D1StatementLike = {
      bind: () => stmt,
      run: async () => ({}),
      first: async () => {
        if (query.includes('FROM properties')) return options.property ?? null;
        return {}; // kpis / dwell rows: all-zero aggregates
      },
      all: async () => {
        if (query.includes("type = 'survey'")) return { results: options.surveyRows ?? [] };
        return { results: [] };
      },
    };
    return stmt;
  };
  return {
    prepare: (query: string) => makeStatement(query),
    batch: async () => [],
  };
}

describe('handleReport authorization', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 404 without a database binding', async () => {
    const res = await handleReport('prop-1', TOKEN, undefined);
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown property', async () => {
    const res = await handleReport('prop-1', TOKEN, fakeDb({ property: null }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for an empty token even when the property exists', async () => {
    const db = fakeDb({ property: { report_token: TOKEN, label: 'Musterhaus' } });
    const res = await handleReport('prop-1', '', db);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a wrong token', async () => {
    const db = fakeDb({ property: { report_token: TOKEN, label: 'Musterhaus' } });
    const res = await handleReport('prop-1', 'wrong-token', db);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the property has no token configured', async () => {
    const db = fakeDb({ property: { report_token: null, label: 'Musterhaus' } });
    const res = await handleReport('prop-1', TOKEN, db);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the property lookup itself throws', async () => {
    const throwingDb: D1Like = {
      prepare: () => {
        const stmt: D1StatementLike = {
          bind: () => stmt,
          run: async () => ({}),
          first: async () => {
            throw new Error('D1 down');
          },
          all: async () => {
            throw new Error('D1 down');
          },
        };
        return stmt;
      },
      batch: async () => [],
    };
    const res = await handleReport('prop-1', TOKEN, throwingDb);
    expect(res.status).toBe(404);
  });

  it('yields the IDENTICAL response for every failure mode (uniform 404)', async () => {
    const withProperty = () => fakeDb({ property: { report_token: TOKEN, label: 'Musterhaus' } });
    const results = await Promise.all([
      handleReport('prop-1', TOKEN, undefined), // no DB
      handleReport('prop-1', TOKEN, fakeDb({ property: null })), // unknown property
      handleReport('prop-1', '', withProperty()), // empty token
      handleReport('prop-1', 'wrong-token', withProperty()), // wrong token
      handleReport('prop-1', TOKEN, fakeDb({ property: { report_token: null } })), // no token configured
      handleReport('INVALID ID', TOKEN, withProperty()), // malformed property id
    ]);
    const [first, ...rest] = results;
    expect(first.status).toBe(404);
    for (const res of rest) {
      // Same status AND byte-identical HTML: no failure mode is distinguishable.
      expect(res.status).toBe(first.status);
      expect(res.html).toBe(first.html);
    }
  });

  it('rejects oversized tokens (> 256 chars) with the same 404', async () => {
    const db = fakeDb({ property: { report_token: TOKEN, label: 'Musterhaus' } });
    const [oversized, noDb] = await Promise.all([
      handleReport('prop-1', 'a'.repeat(257), db),
      handleReport('prop-1', TOKEN, undefined),
    ]);
    expect(oversized.status).toBe(404);
    expect(oversized.html).toBe(noDb.html);
  });

  it('returns 200 with the report HTML for the correct token', async () => {
    const db = fakeDb({
      property: { report_token: TOKEN, label: 'Musterhaus am See' },
      surveyRows: [{ data: '{"rating":5}', n: 2 }],
    });
    const res = await handleReport('prop-1', TOKEN, db);
    expect(res.status).toBe(200);
    expect(res.html).toContain('<!doctype html>');
    expect(res.html).toContain('Musterhaus am See');
    expect(res.html).not.toContain('Bericht nicht gefunden');
  });
});
