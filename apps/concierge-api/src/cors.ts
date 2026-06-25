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
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

/** Build the CORS headers for a resolved (allowlisted) origin. */
export function corsHeaders(allowOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  }
  return headers;
}
