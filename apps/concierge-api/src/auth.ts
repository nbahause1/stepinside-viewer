/**
 * Security utilities shared across the worker: token comparison.
 *
 * Kept separate from analytics/staging so both the owner-report token check
 * (analytics/report) and the optional /stage auth token use one audited
 * implementation.
 */

/**
 * Constant-time token comparison (no early exit on the first differing byte),
 * so a timing side-channel can't reveal how many leading characters matched.
 * Length mismatch returns false immediately — the length itself is not secret.
 */
export function tokensMatch(expected: string, provided: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(provided);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
