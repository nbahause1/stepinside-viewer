# concierge-api

Server-side AI endpoints for the StepInside viewer. All API keys stay
server-side — the browser only ever talks to this service.

One worker, several endpoints:

| Path         | Method | Feature                                    | Upstream                                        |
| ------------ | ------ | ------------------------------------------ | ----------------------------------------------- |
| `/stage`     | POST   | Virtual staging ("Möbliert sehen")         | Google Gemini (`gemini-3-pro-image`, paid)      |
| `/events`    | POST   | Anonymous analytics beacons                | D1 (`ANALYTICS_DB`, optional)                   |
| `/lead`      | POST   | Lead / inquiry form                        | D1 (`ANALYTICS_DB`, optional)                   |
| `/report/{propertyId}` | GET | Owner report (token-gated, self-contained HTML) | D1 (`ANALYTICS_DB`)              |
| anything else | POST  | AI concierge chat (`/concierge` by convention) | Anthropic Claude                            |

The core logic (`core.ts`, `staging.ts`) is framework-agnostic and dependency-
injected; three thin entry points wrap it:

- `src/worker.ts` — **Cloudflare Workers, the deployed entry** (`wrangler.toml` → `main`)
- `src/dev-server.ts` — local Node dev server on `:8787` (`npm run dev`)
- `src/vercel.ts` — Vercel Node-runtime adapter (thin, optional)

---

## `/stage` contract

`POST /stage` with JSON:

```jsonc
{
  "propertyId": "example-fewo",          // ^[a-z0-9-]{1,64}$
  "image": "data:image/jpeg;base64,...", // captured frame; data URL, or raw
                                          // base64 + explicit "mimeType"
  "mimeType": "image/jpeg",              // only when "image" is raw base64
  "style": "classic",                    // optional style id, ^[a-z0-9-]{1,32}$
  "width": 1920,                         // optional, picks the output aspect
  "height": 1080
}
```

Caps: image ≤ ~8 MB decoded (12M base64 chars). The client never sends prompt
text — style ids resolve to server-owned prompts (`staging-prompt.ts`), so
prompt injection via the request body is structurally impossible.

Responses:

| Status | Body                          | Meaning                                                        |
| ------ | ----------------------------- | -------------------------------------------------------------- |
| 200    | `{ "image": "data:image/...", "style": "classic" }` | Furnished frame as a data URL       |
| 400    | `{ "error": ... }`            | Malformed input (validation message)                           |
| 401    | `{ "error": "Unauthorized." }`| `STAGE_AUTH_TOKEN` is set and `x-stage-token` missing/wrong    |
| 413    | `{ "error": "Request body too large." }` | `Content-Length` exceeds the route's body ceiling (rejected before parsing) |
| 429    | `{ "error": ... }` + `Retry-After` | Per-IP rate limit (6 / 5 min), upstream quota, **or** the daily spend cap |
| 500    | `{ "error": "Server is not configured." }` | `GEMINI_API_KEY` missing                          |
| 502    | `{ "error": ... }`            | Upstream failure, safety block, or the 75 s upstream timeout   |

The viewer already maps 429/5xx to friendly German copy; error bodies here are
internal-facing English.

## Demo vs. live mode (viewer side)

The viewer's `settings.json` `staging` block decides whether `/stage` is called
at all:

- `"mode": "demo"` — shows pre-generated images from `staged/` (zero API cost,
  no server needed). This is what ships today.
- `"mode": "live"` — captures the current frame and POSTs it to
  `staging.endpoint`. Requires `endpoint` **and** `propertyId` to be set.

---

## Analytics & Leads (`/events`, `/lead`, `/report/{propertyId}`)

Anonymous, privacy-first usage analytics + lead capture, backed by a D1
database bound as `ANALYTICS_DB`. **Everything is optional:** without the
binding, `/events` and `/lead` answer `202` and drop silently and `/report/*`
is a uniform 404 — the viewer never breaks because analytics is not
provisioned.

### Privacy model (this is a feature, not a footnote)

- **No cookies, no fingerprinting, no stored identifiers.** The viewer
  generates a `sessionId` with `crypto.randomUUID()` and keeps it **in memory
  only** — it dies with the tab. Two visits by the same person are two
  unrelated sessions. The only localStorage use in the viewer is the survey
  module's one-time "already answered/dismissed" flag
  (`sse:survey:{propertyId}`) — a single word, no identifier, no timestamp,
  nothing that links sessions, visitors or properties.
- **No IP addresses, no user agents.** The client IP is used for rate limiting
  only and never reaches the analytics module or the database. There is no
  column it could even go into.
- **Server-side timestamps.** Clients cannot send timestamps; the worker
  stamps events on arrival, so no client clock/timezone data is retained.
- **Tiny, allowlisted events.** Only 12 fixed event types are accepted; the
  optional `data` payload is capped at 500 JSON characters.
- Free text exists only where the visitor typed it deliberately: concierge
  questions (shown anonymously in the report) and the lead form (explicit
  consent required).

### `POST /events` — beacon batch

```jsonc
{
  "propertyId": "example-fewo",                      // ^[a-z0-9-]{1,64}$
  "sessionId": "9b2f3c4d-…",                         // ^[a-f0-9-]{8,64}$, in-memory only
  "events": [                                        // 1–20 events per request
    { "type": "open" },
    { "type": "annotation", "data": { "id": "kitchen" } }  // data ≤ 500 chars JSON
  ]
}
```

Allowed types: `open`, `heartbeat`, `tour_start`, `tour_complete`, `aerial`,
`annotation`, `staging`, `share`, `inquiry_click`, `concierge_question`,
`survey`, `cta_click`. Body ≤ 32 KB, rate limit 60 requests / 5 min per IP
(layered in-memory + KV, same machinery as the other endpoints), plus a global
daily flood cap (`EVENTS_DAILY_LIMIT`, default **50000** batches/UTC day, needs
KV) — past the cap batches are answered `202` and dropped silently. Responses:
`202` stored (or dropped without DB — also `202` on a D1 error or past the
daily cap: losing a beacon must never surface in the tour), `400` invalid,
`413` too large, `429` rate-limited.

Payload conventions the report understands:
`survey` → `{ "rating": 1..4 }` (1 = 👎, 2 = 🤔, 3 = 👍, 4 = 😍);
`annotation` → `{ "id": "...", "label": "..." }`;
`concierge_question` → `{ "q": "..." }`.

### `POST /lead` — inquiry form

```jsonc
{
  "propertyId": "example-fewo",
  "name": "Max Mustermann",        // 1–120 chars
  "contact": "max@example.com",    // 1–200 chars (email or phone)
  "message": "…",                  // optional, ≤ 2000 chars
  "interest": "viewing",           // optional, ≤ 100 chars
  "consent": true                  // MUST be the literal boolean true, else 400
}
```

Rate limit 20 requests / 5 min per IP (generous on purpose: an open house on
shared WiFi puts many visitors behind one NAT IP), body ≤ 16 KB. Abuse is
bounded by a global daily cap instead (`LEAD_DAILY_LIMIT`, default **200**
leads/UTC day, needs KV). `202` stored, `400` invalid/missing consent, `429`
with `Retry-After` past a limit, `500` if the D1 insert fails (a lead is a
customer inquiry — unlike beacons it is NOT dropped silently).

### `GET /report/{propertyId}?token=…` — owner report

Self-contained German HTML (inline CSS, no JS, mobile-friendly): KPI row
(Aufrufe, Ø Verweildauer, Tour-Starts/-Abschlüsse, Staging-Nutzungen,
Share-Klicks), top annotations, survey distribution, CTA-Klicks vs. Leads,
the visitors' verbatim concierge questions (flagged in the report as
potentially containing personal data — treat confidentially), and the leads
table. All aggregation happens in SQL. Ø Verweildauer averages each session's
highest heartbeat `seconds` value (visible time only, capped at 30 min per
session; sessions without heartbeats are ignored).

The token is compared **constant-time** against `properties.report_token`;
any mismatch — wrong token, unknown property, no DB — returns the **same 404
page**, so the endpoint never reveals whether a property exists. The response
carries `Referrer-Policy: no-referrer` (the token travels in the URL),
`Cache-Control: no-store` and `X-Robots-Tag: noindex`.

### Setup

```sh
cd apps/concierge-api

# 1. Create the database and apply the migration
npx wrangler d1 create stepinside-analytics
#    -> paste the printed database_id into the [[d1_databases]] block in wrangler.toml
npx wrangler d1 migrations apply stepinside-analytics --remote

# 2. Register a property + generate its report token (any long random secret)
#    (openssl on Windows: use Git Bash, or any other 32+ byte random source)
TOKEN=$(openssl rand -hex 32)
npx wrangler d1 execute stepinside-analytics --remote --command \
  "INSERT INTO properties (property_id, report_token, label) VALUES ('example-fewo', '$TOKEN', 'Ferienwohnung Beispiel');"
echo "Report: https://<worker-url>/report/example-fewo?token=$TOKEN"

npm run deploy
```

Rotate a token with an `UPDATE properties SET report_token = '<new>' WHERE
property_id = '...'` via the same `d1 execute` command.

### GDPR / DSGVO notes

- Metric events (opens, heartbeats, feature usage) are **anonymous by design**
  (no cookies, no IPs, no cross-visit identifiers) — there is nothing to link
  to a person.
- **Concierge questions are stored verbatim** and shown word-for-word in the
  report. They carry no person/session linkage in the database, but visitors
  routinely type personal data into free text (names, phone numbers, travel
  plans) — so treat them as potentially personal data: the report must be
  handled confidentially (it says so above the list), and the stored questions
  should be deleted or anonymized once the marketing period for the property
  ends, e.g. `npx wrangler d1 execute stepinside-analytics --remote --command
  "DELETE FROM events WHERE property_id = '...' AND type =
  'concierge_question';"`.
- Leads DO contain personal data, which is why `/lead` refuses anything
  without `consent: true` (the viewer's form has an explicit checkbox). Legal
  basis: consent / pre-contractual steps (Art. 6 (1) a/b GDPR).
- Data minimization: name + contact + optional message/interest, nothing else.
- Deletion requests: `npx wrangler d1 execute stepinside-analytics --remote
  --command "DELETE FROM leads WHERE contact = '...';"`.

---

## Hardening (server side)

Defense layers, in request order (Workers entry):

1. **CORS allowlist** (`ALLOWED_ORIGINS`) — browsers from other origins can't
   read responses. Not a security boundary against curl.
2. **Optional auth** (`STAGE_AUTH_TOKEN`) — when this secret is set, `/stage`
   requires a matching `x-stage-token` header and returns 401 otherwise
   (checked before the multi-MB body is even read; constant-time compare).
   When unset, behavior is unchanged — the public demo stays frictionless.
   Note: the viewer does not currently send this header, so only enable it for
   curl/partner/backend integrations until the viewer wiring exists.
3. **Body-size ceiling** — the `Content-Length` header is checked against a
   per-route maximum (~13 MB for `/stage`, 256 KB for the concierge) and
   oversized requests get 413 **before the body is read or parsed**.
4. **Per-IP rate limit** — 6 requests / 5 min on `/stage`, 20 / 5 min on the
   concierge (keyed on `cf-connecting-ip`), enforced **before `request.json()`**
   so a limited client can't force multi-MB JSON parsing. With `RATE_LIMIT_KV`
   bound, limiting is **layered**: the free per-isolate in-memory limiter runs
   first (catches same-isolate bursts that slip through the racy KV
   get-then-put), then the KV-backed fixed-window counter shared across all
   isolates/colos — both must pass. Without KV only the in-memory limiter
   remains, which is **weak on Workers** (isolates don't share memory) — the
   worker logs a warning on first request.
5. **Global daily spend/flood caps** (kill-switch) — with `RATE_LIMIT_KV`
   bound, each capped endpoint has its own shared daily counter (TTL 2 days)
   that counts every request passing rate limiting + validation:
   - `/stage` → `spend:YYYY-MM-DD`, capped by `STAGE_DAILY_LIMIT`
     (default **200**/UTC day, paid Gemini call).
   - concierge → `spend:concierge:YYYY-MM-DD`, capped by
     `CONCIERGE_DAILY_LIMIT` (default **1000**/UTC day, paid Anthropic call).
   - `/events` → `spend:events:YYYY-MM-DD`, capped by `EVENTS_DAILY_LIMIT`
     (default **50000**/UTC day, D1 writes + report noise). Past the cap
     batches are answered **202 and dropped silently** — analytics must never
     break the viewer.
   - `/lead` → `spend:lead:YYYY-MM-DD`, capped by `LEAD_DAILY_LIMIT`
     (default **200**/UTC day). A capped lead IS surfaced (429) — see below.

   Past a cap all further requests get 429 with `Retry-After` until UTC
   midnight (except `/events`, which drops silently). This bounds the
   worst-case daily spend/flood regardless of how distributed an abuser is.
   **Disabled without KV.**
6. **Upstream timeout** — every Gemini call aborts after 75 s
   (AbortController), surfacing the existing 502 path instead of hanging the
   Worker and the visitor.

### Soft-limit semantics (fail open)

All KV-backed limits — the rate limiters **and** both daily budgets — are
**soft limits**:

- KV `get`/`put` is not atomic and eventually consistent, so bursts can
  overshoot a limit by a few requests.
- Any KV I/O error (e.g. KV's 1-write/sec-per-key cap on the deliberately hot
  `spend:*` keys) logs a `console.warn` and **fails open**: the request is
  allowed instead of failing with a 500. Availability is deliberately favored
  over strictness — a KV hiccup must not take the endpoints down.

Fine for abuse/cost protection; use a Durable Object if you ever need strict
counting.

## Configuration reference

### Secrets (`wrangler secret put <NAME>`; never committed)

| Secret              | Required | Purpose                                          |
| ------------------- | -------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY` | yes      | Concierge chat (Claude)                          |
| `GEMINI_API_KEY`    | for /stage | Virtual staging (Gemini image model)           |
| `STAGE_AUTH_TOKEN`  | no       | When set, `/stage` requires `x-stage-token`      |

For local dev put them in `.dev.vars` (gitignored, loaded by `npm run dev` and
`wrangler dev`). **Never commit or print `.dev.vars`.**

### Vars (`[vars]` in `wrangler.toml`, or dashboard)

| Var                     | Default | Purpose                                              |
| ----------------------- | ------- | ---------------------------------------------------- |
| `ALLOWED_ORIGINS`       | localhost dev list | Comma-separated CORS origin allowlist     |
| `STAGE_DAILY_LIMIT`     | `200`   | Max `/stage` generations per UTC day (needs KV)      |
| `CONCIERGE_DAILY_LIMIT` | `1000`  | Max concierge chat turns per UTC day (needs KV)      |
| `EVENTS_DAILY_LIMIT`    | `50000` | Max `/events` batches stored per UTC day (needs KV)  |
| `LEAD_DAILY_LIMIT`      | `200`   | Max leads stored per UTC day (needs KV)              |

### Bindings

| Binding         | Type | Purpose                                                |
| --------------- | ---- | ------------------------------------------------------ |
| `RATE_LIMIT_KV` | KV   | Shared rate-limit counters + daily spend cap           |

Provision once (needs Cloudflare account access), then uncomment the
`kv_namespaces` block in `wrangler.toml` with the printed id:

```sh
npx wrangler kv namespace create RATE_LIMIT_KV
```

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "<id printed by the create command>"
```

## Deploy

```sh
cd apps/concierge-api
npm install
npm run type:check

# one-time setup
npx wrangler kv namespace create RATE_LIMIT_KV   # then uncomment in wrangler.toml
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put STAGE_AUTH_TOKEN             # optional
# set ALLOWED_ORIGINS (+ optionally the *_DAILY_LIMIT vars) under [vars]

npm run deploy                                   # = wrangler deploy
```

Local development:

```sh
npm run dev          # Node dev server on http://localhost:8787 (.dev.vars)
npm run dev:worker   # wrangler dev (Workers runtime, also reads .dev.vars)
```

The Node dev server and the Vercel adapter always use the in-memory limiter
(single process — that's fine there) and have no daily spend caps.

## Known gap: localhost vs. production wiring in `settings.json`

The viewer config `apps/website/public/viewer/settings.json` currently points
both AI features at the **local dev server**:

```jsonc
"concierge": { "endpoint": "http://localhost:8787/concierge", ... },
"staging":   { "mode": "demo", "endpoint": "http://localhost:8787/stage", ... }
```

That works on a dev machine and is harmless in production **only because**
`staging.mode` is `"demo"` (no request is made) and the scripted concierge
doesn't call out either. Before switching either feature to live mode in
production you must:

1. Deploy this worker and note its URL
   (`https://concierge-api.<account>.workers.dev` or a custom domain/route).
2. Point `settings.json` endpoints at that URL
   (`https://.../stage`, `https://.../concierge`).
3. Set `ALLOWED_ORIGINS` on the worker to the production site origin
   (e.g. `https://www.example.com`) — otherwise the browser blocks the
   response (the built-in allowlist covers localhost only).
4. Bind `RATE_LIMIT_KV` first — going live without it means weak rate limits
   and **no spend cap** on a paid endpoint.

There is no environment switch in the viewer today: the same `settings.json`
is served everywhere, so the endpoint has to be edited when promoting to
production (or the file split per environment as a future improvement).
