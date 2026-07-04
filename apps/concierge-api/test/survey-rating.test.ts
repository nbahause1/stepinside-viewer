/**
 * Regression test for the survey-rating parser (extractSurveyRating in
 * analytics.ts). The viewer's survey card is a 1-5 helpfulness scale and the
 * report renders 5 buckets — an earlier version of the parser capped at 4 and
 * silently dropped every TOP rating from the owner report. This suite pins
 * the full 1..5 range (especially 5) across all accepted payload shapes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractSurveyRating, handleReport } from '../src/analytics.js';
import type { D1Like, D1StatementLike } from '../src/analytics.js';

describe('extractSurveyRating', () => {
  it('accepts the full 1..5 range in the canonical {"rating":n} shape — including 5', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(extractSurveyRating(JSON.stringify({ rating }))).toBe(rating);
    }
  });

  it('REGRESSION: the top rating 5 is not dropped', () => {
    expect(extractSurveyRating('{"rating":5}')).toBe(5);
    expect(extractSurveyRating('5')).toBe(5);
    expect(extractSurveyRating('"5"')).toBe(5);
    expect(extractSurveyRating('{"value":5}')).toBe(5);
  });

  it('accepts a bare JSON number', () => {
    expect(extractSurveyRating('3')).toBe(3);
  });

  it('accepts a numeric JSON string', () => {
    expect(extractSurveyRating('"4"')).toBe(4);
  });

  it('accepts the {"value":n} fallback shape', () => {
    expect(extractSurveyRating('{"value":2}')).toBe(2);
  });

  it('rejects out-of-range ratings (0 and 6)', () => {
    expect(extractSurveyRating('{"rating":0}')).toBeNull();
    expect(extractSurveyRating('{"rating":6}')).toBeNull();
    expect(extractSurveyRating('0')).toBeNull();
    expect(extractSurveyRating('6')).toBeNull();
    expect(extractSurveyRating('-1')).toBeNull();
  });

  it('rejects non-integer ratings', () => {
    expect(extractSurveyRating('{"rating":4.5}')).toBeNull();
  });

  it('rejects strings without a leading number and NaN-producing input', () => {
    expect(extractSurveyRating('"great"')).toBeNull();
    expect(extractSurveyRating('{"rating":"loved it"}')).toBeNull();
    expect(extractSurveyRating('{"rating":null}')).toBeNull();
    expect(extractSurveyRating('{}')).toBeNull();
    expect(extractSurveyRating('null')).toBeNull();
    expect(extractSurveyRating('true')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(extractSurveyRating('not json')).toBeNull();
    expect(extractSurveyRating('{rating:5}')).toBeNull();
  });

  it('rejects non-string data (NULL column, numbers, objects)', () => {
    expect(extractSurveyRating(null)).toBeNull();
    expect(extractSurveyRating(undefined)).toBeNull();
    expect(extractSurveyRating(5)).toBeNull();
    expect(extractSurveyRating({ rating: 5 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end through the report: a 5-star survey row must show up in the
// rendered owner report (bucket 5 populated, average "5.0").
// ---------------------------------------------------------------------------

const TOKEN = 'report-token-1234';

function fakeDb(surveyRows: Record<string, unknown>[]): D1Like {
  const makeStatement = (query: string): D1StatementLike => {
    const stmt: D1StatementLike = {
      bind: () => stmt,
      run: async () => ({}),
      first: async () => {
        if (query.includes('FROM properties')) return { report_token: TOKEN, label: 'Testhaus' };
        return {};
      },
      all: async () => {
        if (query.includes("type = 'survey'")) return { results: surveyRows };
        return { results: [] };
      },
    };
    return stmt;
  };
  return { prepare: (query) => makeStatement(query), batch: async () => [] };
}

describe('survey ratings in the rendered report', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a pure 5-star result renders an average of 5.0 instead of "no ratings"', async () => {
    const res = await handleReport('prop-1', TOKEN, fakeDb([{ data: '{"rating":5}', n: 3 }]));
    expect(res.status).toBe(200);
    expect(res.html).toContain('Ø 5.0 / 5');
    expect(res.html).not.toContain('Noch keine Bewertungen abgegeben.');
  });

  it('mixed shapes and ranges: only valid 1..5 ratings are bucketed', async () => {
    const res = await handleReport(
      'prop-1',
      TOKEN,
      fakeDb([
        { data: '{"rating":5}', n: 1 },
        { data: '5', n: 1 }, // bare number, also a top rating
        { data: '"5"', n: 1 }, // numeric string
        { data: '{"rating":1}', n: 1 },
        { data: '{"rating":6}', n: 99 }, // out of range: ignored
        { data: '{"rating":0}', n: 99 }, // out of range: ignored
        { data: 'garbage', n: 99 }, // unparseable: ignored
      ]),
    );
    expect(res.status).toBe(200);
    // 3x rating 5 + 1x rating 1 => avg (15+1)/4 = 4.0
    expect(res.html).toContain('Ø 4.0 / 5');
  });
});
