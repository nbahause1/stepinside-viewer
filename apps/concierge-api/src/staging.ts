/**
 * Framework-agnostic virtual-staging brain ("AI Reframe").
 *
 * Takes a flat 2D render of an empty room + a style id, returns a flat 2D image
 * of the same room furnished. The model never sees the 3D splat — pure
 * image-to-image. Same dependency-injection shape as the concierge core, so it
 * runs verbatim on Cloudflare Workers, the local Node dev server, and Vercel.
 *
 * Provider: Google Gemini ("Nano Banana" = Gemini 2.5 Flash Image). The flow is:
 *   1. Rate-limit (per clientIp) -> 429 before any work (image calls are pricey).
 *   2. Validate input caps -> 400.
 *   3. Resolve the style id to a server-owned prompt.
 *   4. Call `:generateContent` with the prompt + the captured frame inline.
 *   5. Pull the returned inline image and hand it back as a data URL.
 *
 * No upload step and no polling: Gemini takes the image inline in the request
 * and returns the generated image inline in the response. We hand-roll the REST
 * call with `fetch` (no SDK) so the same code runs on Workers, Node, and Vercel.
 *
 * The GEMINI_API_KEY lives server-side only; the browser never sees it.
 */
import { validateStagingRequest, StagingValidationError } from './staging-validation.js';
import { buildStagingPrompt, resolveStyle } from './staging-prompt.js';
import type { RateLimiter } from './ratelimit.js';

/** Dependencies injected by each entry point. */
export interface StagingDeps {
  /** Google Gemini API key (server-side only). */
  geminiApiKey: string;
  rateLimiter: RateLimiter;
  /** Best-effort client IP for rate limiting; '' if unknown. */
  clientIp: string;
}

/** A normalized result the entry points translate into their native response. */
export interface StagingResult {
  status: number;
  body: Record<string, unknown>;
  retryAfterSeconds?: number;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// "Nano Banana 2" — Google's image-editing model. It keeps the room and adds
// furniture, returning the result inline as base64. We use the 3.1 flash model
// (over the older 2.5, which only outputs ~1K) so the staged image is sharp
// enough to sit beside the high-quality live scan without an obvious quality
// drop. For maximum fidelity swap to 'gemini-3-pro-image' (Nano Banana Pro),
// at higher cost/latency.
const GEMINI_MODEL = 'gemini-3.1-flash-image';

// Output resolution requested via generationConfig.imageConfig (Gemini 3 image
// models support '1K' | '2K' | '4K'). 2K closely matches the scan's crispness.
const GEMINI_IMAGE_SIZE = '2K';

// Supported output aspect-ratio enums (Gemini 3 image). We pick the one closest
// to the captured frame so the staged image lines up with the live scan.
const ASPECT_RATIOS: { label: string; ratio: number }[] = [
  { label: '21:9', ratio: 21 / 9 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '5:4', ratio: 5 / 4 },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '9:16', ratio: 9 / 16 },
];

/** Closest supported aspect-ratio label for a captured frame (default 16:9). */
function pickAspectRatio(width?: number, height?: number): string {
  if (!width || !height) return '16:9';
  const target = width / height;
  let best = ASPECT_RATIOS[1];
  let bestDelta = Infinity;
  for (const a of ASPECT_RATIOS) {
    const delta = Math.abs(a.ratio - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = a;
    }
  }
  return best.label;
}

export async function handleStaging(
  rawBody: unknown,
  deps: StagingDeps,
): Promise<StagingResult> {
  // 1. Rate-limit first, keyed on the client IP (fallback to a shared bucket).
  const rateKey = deps.clientIp || 'unknown';
  const rate = await deps.rateLimiter.check(rateKey);
  if (!rate.allowed) {
    return {
      status: 429,
      body: { error: 'Too many requests. Please slow down.' },
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  // 2. Validate input caps.
  let request;
  try {
    request = validateStagingRequest(rawBody);
  } catch (err) {
    if (err instanceof StagingValidationError) {
      return { status: 400, body: { error: err.message } };
    }
    return { status: 400, body: { error: 'Invalid request.' } };
  }

  // 3. Resolve the style id to a server-owned prompt (client never sends text).
  const style = resolveStyle(request.style);
  const prompt = buildStagingPrompt(style);

  try {
    // 4/5. Generate + extract the inline image.
    const aspectRatio = pickAspectRatio(request.width, request.height);
    const image = await generateWithGemini(
      deps.geminiApiKey,
      prompt,
      request.imageBase64,
      request.mimeType,
      aspectRatio,
    );
    if (!image) {
      return { status: 502, body: { error: 'No image was generated. Please try again.' } };
    }
    return { status: 200, body: { image, style: style.id } };
  } catch (err) {
    if (err instanceof GeminiError) {
      console.warn(`[staging] Gemini ${err.status}:`, err.detail.slice(0, 600));
      if (err.status === 429) {
        return { status: 429, body: { error: 'Upstream rate limit. Please retry shortly.' }, retryAfterSeconds: 30 };
      }
      if (err.status === 400 || err.status === 403) {
        // Bad/again-missing key or quota/billing problem on our side.
        return { status: 502, body: { error: 'The staging service is misconfigured.' } };
      }
    } else {
      console.warn('[staging] unexpected error:', String(err));
    }
    return { status: 502, body: { error: 'The staging service is temporarily unavailable.' } };
  }
}

/** Carries the upstream HTTP status + detail so the core can map errors. */
class GeminiError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`Gemini ${status}`);
    this.name = 'GeminiError';
  }
}

/**
 * Call Gemini's image model with the prompt + the captured frame inline, and
 * return the first generated image as a `data:` URL (or null if none came back).
 */
async function generateWithGemini(
  apiKey: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  aspectRatio: string,
): Promise<string | null> {
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
      // Gemini 3 image models: request a high-res output at the frame's aspect.
      generationConfig: {
        imageConfig: { imageSize: GEMINI_IMAGE_SIZE, aspectRatio },
      },
    }),
  });

  if (!res.ok) {
    throw new GeminiError(res.status, await safeText(res));
  }

  const data = (await res.json()) as GenerateContentResponse;

  // A safety block returns 200 with no image but a blockReason.
  const blocked = data.promptFeedback?.blockReason;
  if (blocked) {
    throw new GeminiError(502, `blocked: ${blocked}`);
  }

  return firstInlineImage(data);
}

/** The slice of the generateContent response we read. */
interface GenerateContentResponse {
  candidates?: {
    content?: {
      parts?: {
        inlineData?: { mimeType?: string; data?: string };
        // Some responses use snake_case in the wild; accept both.
        inline_data?: { mime_type?: string; data?: string };
      }[];
    };
  }[];
  promptFeedback?: { blockReason?: string };
}

/** Pull the first inline image part out of the response as a data URL. */
function firstInlineImage(data: GenerateContentResponse): string | null {
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data;
      const b64 = inline?.data;
      if (typeof b64 === 'string' && b64.length > 0) {
        const mime =
          (part.inlineData?.mimeType ?? part.inline_data?.mime_type) || 'image/png';
        return `data:${mime};base64,${b64}`;
      }
    }
  }
  return null;
}

async function safeText(res: Response): Promise<string> {
  return res.text().catch(() => '');
}
