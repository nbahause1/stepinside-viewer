-- Migration 0001: anonymous analytics + leads.
--
-- Privacy model (deliberate, see README.md):
--   - NO IP addresses, NO user agents, NO fingerprints are ever stored.
--   - session_id is a crypto-random id the viewer keeps IN MEMORY only; it
--     dies with the tab and is never linked across visits.
--   - events.data is a small (<=500 chars) JSON blob the server never
--     enriches with request metadata.
--
-- Apply:
--   npx wrangler d1 migrations apply stepinside-analytics --remote

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT    NOT NULL,
  session_id  TEXT    NOT NULL,
  ts          INTEGER NOT NULL, -- server-side Unix epoch millis
  type        TEXT    NOT NULL, -- fixed allowlist, enforced in analytics.ts
  data        TEXT              -- optional JSON payload (<=500 chars) or NULL
);

CREATE INDEX IF NOT EXISTS idx_events_property_ts   ON events (property_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_property_type ON events (property_id, type);

CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY,
  property_id TEXT    NOT NULL,
  ts          INTEGER NOT NULL, -- server-side Unix epoch millis
  name        TEXT    NOT NULL,
  contact     TEXT    NOT NULL, -- email or phone, free-form
  message     TEXT,
  interest    TEXT,
  consent     INTEGER NOT NULL  -- 1 = explicit consent (literal true required by the API)
);

CREATE INDEX IF NOT EXISTS idx_leads_property_ts ON leads (property_id, ts);

CREATE TABLE IF NOT EXISTS properties (
  property_id  TEXT PRIMARY KEY,
  report_token TEXT,            -- long random secret; grants read access to /report/{id}
  label        TEXT             -- human-readable name shown in the report header
);
