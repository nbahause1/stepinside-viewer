# concierge-api

Server-side AI endpoints for the StepInside viewer. All API keys stay
server-side — the browser only ever talks to this service.

Two endpoints, one worker:

| Path         | Feature                                    | Upstream                                        |
| ------------ | ------------------------------------------ | ----------------------------------------------- |
| `/stage`     | Virtual staging ("Möbliert sehen")         | Google Gemini (`gemini-3-pro-image`, paid)      |
| anything else | AI concierge chat (`/concierge` by convention) | Anthropic Claude                            |

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

## Hardening (server side)

Defense layers on `/stage`, in request order:

1. **CORS allowlist** (`ALLOWED_ORIGINS`) — browsers from other origins can't
   read responses. Not a security boundary against curl.
2. **Optional auth** (`STAGE_AUTH_TOKEN`) — when this secret is set, `/stage`
   requires a matching `x-stage-token` header and returns 401 otherwise
   (checked before the multi-MB body is even read; constant-time compare).
   When unset, behavior is unchanged — the public demo stays frictionless.
   Note: the viewer does not currently send this header, so only enable it for
   curl/partner/backend integrations until the viewer wiring exists.
3. **Per-IP rate limit** — 6 requests / 5 min (keyed on `cf-connecting-ip`).
   With `RATE_LIMIT_KV` bound this is a KV-backed fixed-window counter shared
   across all isolates/colos; without it, a per-isolate in-memory limiter that
   is **weak on Workers** (isolates don't share memory) — the worker logs a
   warning on first request.
4. **Global daily spend cap** (kill-switch) — with `RATE_LIMIT_KV` bound, a
   shared counter `spend:YYYY-MM-DD` (TTL 2 days) counts every request that
   passes rate limiting + validation, i.e. every request that would hit the
   paid Gemini API. Past `STAGE_DAILY_LIMIT` (default **200**/UTC day) all
   further requests get 429 with `Retry-After` until UTC midnight. This bounds
   the worst-case daily spend regardless of how distributed an abuser is.
   **Disabled without KV.**
5. **Upstream timeout** — every Gemini call aborts after 75 s
   (AbortController), surfacing the existing 502 path instead of hanging the
   Worker and the visitor.

KV counters are eventually consistent, so bursts can overshoot limits by a few
requests — fine for abuse/cost protection; use a Durable Object if you ever
need strict counting.

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

| Var                 | Default | Purpose                                            |
| ------------------- | ------- | -------------------------------------------------- |
| `ALLOWED_ORIGINS`   | localhost dev list | Comma-separated CORS origin allowlist   |
| `STAGE_DAILY_LIMIT` | `200`   | Max `/stage` generations per UTC day (needs KV)    |

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
# set ALLOWED_ORIGINS (+ optionally STAGE_DAILY_LIMIT) under [vars]

npm run deploy                                   # = wrangler deploy
```

Local development:

```sh
npm run dev          # Node dev server on http://localhost:8787 (.dev.vars)
npm run dev:worker   # wrangler dev (Workers runtime, also reads .dev.vars)
```

The Node dev server and the Vercel adapter always use the in-memory limiter
(single process — that's fine there) and have no daily spend cap.

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
