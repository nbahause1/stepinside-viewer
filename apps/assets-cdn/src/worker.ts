/**
 * Scan-asset CDN: serves the 3D Gaussian-splatting scenes (SOG/LOD chunks +
 * collision) from R2, so they no longer live in the git repo / Vercel deploy.
 *
 * Keys are `{propertyId}/{version}/{path}` (e.g. demo-altbau/v1/scene-pruned/
 * lod-meta.json). The version segment makes every URL content-stable, so the
 * immutable, one-year cache below is correct — a re-export bumps the version,
 * never overwrites a served path.
 *
 * Read-only, public, GET/HEAD only. CORS is open (splats are public product
 * assets, fetched cross-origin by the viewer wherever it is embedded).
 */
interface Env {
  ASSETS: R2Bucket;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-None-Match',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, Accept-Ranges',
};

// path segment allow-list: property/version/nested asset path
const KEY_RE = /^[a-z0-9][a-z0-9._\/-]{0,255}$/;

const contentTypeFor = (key: string): string => {
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    if (!key || !KEY_RE.test(key) || key.includes('..')) {
      return new Response('Not found', { status: 404, headers: CORS });
    }

    // Conditional GET: honour the client's cached ETag.
    const inm = request.headers.get('If-None-Match') ?? undefined;
    const rangeHeader = request.headers.get('Range') ?? undefined;
    const parsedRange = rangeHeader ? parseRange(rangeHeader) : undefined;

    const object = await env.ASSETS.get(key, {
      onlyIf: inm ? { etagDoesNotMatch: inm } : undefined,
      range: parsedRange,
    });

    if (!object) {
      // Either genuinely missing, or a 304 (etag matched → body omitted).
      if (inm) {
        return new Response(null, { status: 304, headers: { ...CORS, ETag: inm } });
      }
      return new Response('Not found', { status: 404, headers: CORS });
    }

    const headers = new Headers(CORS);
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Content-Type', object.httpMetadata?.contentType ?? contentTypeFor(key));
    // Versioned path ⇒ safe to cache hard at the browser and the Cloudflare edge.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Accept-Ranges', 'bytes');

    // 206 only when the CLIENT actually asked for a range (object.range is
    // populated by R2 even on full gets, so gate on the request, not the object).
    if (parsedRange && object.range) {
      const r = object.range as { offset: number; length: number };
      headers.set('Content-Range', `bytes ${r.offset}-${r.offset + r.length - 1}/${object.size}`);
      return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
    }

    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
  },
};

// Minimal `Range: bytes=start-end` parser → R2 range option.
function parseRange(header: string): { offset: number; length?: number } | undefined {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  return end !== undefined ? { offset: start, length: end - start + 1 } : { offset: start };
}
