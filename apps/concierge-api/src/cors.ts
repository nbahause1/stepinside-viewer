/**
 * CORS helpers: origin allowlist + preflight handling.
 *
 * Every entry point (worker, vercel, dev-server) must:
 *   - answer OPTIONS preflight with the echoed allowlisted origin, and
 *   - echo that same origin on the POST response.
 */

/** Built-in dev origins used when no allowlist is configured. */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:4500',
  'http://127.0.0.1:4500',
  'http://localhost:8787',
  // The website (Next dev, port 3000) embeds the viewer — local chat tests
  // against `npm run dev` (dev-server.ts) run under THIS origin, not 4500.
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/** Parse a comma-separated ALLOWED_ORIGINS value into a clean list. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  const parsed = value
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_ORIGINS];
}

/**
 * Resolve the Access-Control-Allow-Origin value to echo for a request origin.
 * Returns the origin if allowlisted, otherwise null (caller omits the header).
 */
export function resolveAllowOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[],
): string | null {
  if (!requestOrigin) {
    return null;
  }
  // '*' in the allowlist echoes any origin. DEV/TEST ONLY (e.g. a Vercel
  // preview whose URL isn't known before the deploy) — never configure a
  // production deployment with it; the per-IP rate limits are then the only
  // thing bounding who can spend model budget.
  if (allowedOrigins.includes('*')) {
    return requestOrigin;
  }
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

/** Build the CORS headers for a resolved (allowlisted) origin. */
export function corsHeaders(allowOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // x-stage-token: optional /stage auth header (STAGE_AUTH_TOKEN). Listing it
    // unconditionally is harmless — it only matters when the client sends it.
    'Access-Control-Allow-Headers': 'Content-Type, x-stage-token',
    // Retry-After is not CORS-safelisted; without exposing it the viewer cannot
    // distinguish the daily budget cap from the per-minute rate limit on 429.
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  }
  return headers;
}
