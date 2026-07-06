/**
 * Owner-report AGGREGATION: runs the read-only SQL over events/leads and
 * shapes the result for the renderer (report.ts). Split out of analytics.ts,
 * which now owns only /events + /lead ingestion + the /report auth gate.
 *
 * All queries are parameterized (?1 bindings). No writes.
 */
import type { D1Like } from './analytics.js';
import type { ReportData, ReportLeadRow } from './report.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Run all report aggregations in SQL and shape them for the renderer. */
export async function collectReportData(
  db: D1Like,
  propertyId: string,
  label: string | null,
): Promise<ReportData> {
  const kpis = await db
    .prepare(
      `SELECT
         COUNT(CASE WHEN type = 'open' THEN 1 END)          AS opens,
         COUNT(CASE WHEN type = 'tour_start' THEN 1 END)    AS tour_starts,
         COUNT(CASE WHEN type = 'tour_complete' THEN 1 END) AS tour_completes,
         COUNT(CASE WHEN type = 'staging' THEN 1 END)       AS stagings,
         COUNT(CASE WHEN type = 'share' THEN 1 END)         AS shares,
         COUNT(CASE WHEN type = 'cta_click' THEN 1 END)     AS cta_clicks
       FROM events WHERE property_id = ?1`,
    )
    .bind(propertyId)
    .first();

  // Dwell time per session from the heartbeat payloads: each heartbeat carries
  // the session's accumulated VISIBLE seconds (the viewer's clock stops while
  // the tab is hidden), so the highest value per session is that session's
  // dwell — unlike server-timestamp spans, hidden-tab gaps don't count. Each
  // session is capped at 30 min so one tab left open cannot inflate the
  // average; sessions without heartbeats are ignored.
  const dwell = await db
    .prepare(
      `SELECT AVG(dur_s) AS avg_dwell_s FROM (
         SELECT MIN(MAX(json_extract(data, '$.seconds')), 1800) AS dur_s
         FROM events
         WHERE property_id = ?1 AND type = 'heartbeat'
           AND typeof(json_extract(data, '$.seconds')) IN ('integer', 'real')
         GROUP BY session_id
       )`,
    )
    .bind(propertyId)
    .first();

  const annotations = await db
    .prepare(
      `SELECT data, COUNT(*) AS n FROM events
       WHERE property_id = ?1 AND type = 'annotation' AND data IS NOT NULL
       GROUP BY data ORDER BY n DESC LIMIT 8`,
    )
    .bind(propertyId)
    .all();

  const survey = await db
    .prepare(
      `SELECT data, COUNT(*) AS n FROM events
       WHERE property_id = ?1 AND type = 'survey'
       GROUP BY data`,
    )
    .bind(propertyId)
    .all();

  const questions = await db
    .prepare(
      `SELECT ts, data FROM events
       WHERE property_id = ?1 AND type = 'concierge_question' AND data IS NOT NULL
       ORDER BY ts DESC LIMIT 100`,
    )
    .bind(propertyId)
    .all();

  const leads = await db
    .prepare(
      `SELECT ts, name, contact, interest, timeframe FROM leads
       WHERE property_id = ?1 ORDER BY ts DESC LIMIT 200`,
    )
    .bind(propertyId)
    .all();

  const num = (row: Record<string, unknown> | null, key: string): number => {
    const v = row?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };

  // 1-5 helpfulness scale ("Wie hilfreich war dieser Rundgang?")
  const surveyBuckets = [0, 0, 0, 0, 0];
  for (const row of survey.results) {
    const rating = extractSurveyRating(row['data']);
    const n = typeof row['n'] === 'number' ? row['n'] : 0;
    if (rating !== null && rating >= 1 && rating <= 5) surveyBuckets[rating - 1] += n;
  }

  const avgDwellRaw = dwell?.['avg_dwell_s'];

  return {
    propertyId,
    label,
    generatedAt: Date.now(),
    opens: num(kpis, 'opens'),
    avgDwellMs: typeof avgDwellRaw === 'number' && Number.isFinite(avgDwellRaw) ? avgDwellRaw * 1000 : null,
    tourStarts: num(kpis, 'tour_starts'),
    tourCompletes: num(kpis, 'tour_completes'),
    stagings: num(kpis, 'stagings'),
    shares: num(kpis, 'shares'),
    ctaClicks: num(kpis, 'cta_clicks'),
    annotations: annotations.results.map((row) => ({
      label: extractLabel(row['data']),
      count: typeof row['n'] === 'number' ? row['n'] : 0,
    })),
    survey: surveyBuckets,
    questions: questions.results
      .map((row) => ({
        ts: typeof row['ts'] === 'number' ? row['ts'] : 0,
        text: extractQuestion(row['data']),
      }))
      .filter((q) => q.text.length > 0),
    leads: leads.results.map((row): ReportLeadRow => ({
      ts: typeof row['ts'] === 'number' ? row['ts'] : 0,
      name: typeof row['name'] === 'string' ? row['name'] : '',
      contact: typeof row['contact'] === 'string' ? row['contact'] : '',
      interest: typeof row['interest'] === 'string' ? row['interest'] : null,
      timeframe: typeof row['timeframe'] === 'string' ? row['timeframe'] : null,
    })),
  };
}

/** Parse `{ "rating": 1..5 }` (canonical), a bare number, or numeric string. */
export function extractSurveyRating(data: unknown): number | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    const candidate = isObject(parsed)
      ? (parsed['rating'] ?? parsed['value'])
      : parsed;
    const n = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate), 10);
    // The viewer's survey card is a 1-5 helpfulness scale (survey.ts) and the
    // report buckets/renderer model 1-5 — this parser capping at 4 silently
    // dropped every TOP rating from the owner report.
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  } catch {
    return null;
  }
}

/** Best-effort label from an annotation payload: {label}/{id}/plain string. */
function extractLabel(data: unknown): string {
  if (typeof data !== 'string') return '';
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'string') return parsed;
    if (isObject(parsed)) {
      const label = parsed['label'] ?? parsed['id'];
      if (typeof label === 'string') return label;
    }
  } catch {
    /* fall through to raw */
  }
  return data;
}

/** Best-effort question text: {q}/{question}/{text}/plain string. */
function extractQuestion(data: unknown): string {
  if (typeof data !== 'string') return '';
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'string') return parsed.trim();
    if (isObject(parsed)) {
      const q = parsed['q'] ?? parsed['question'] ?? parsed['text'];
      if (typeof q === 'string') return q.trim();
    }
  } catch {
    /* fall through */
  }
  return '';
}
