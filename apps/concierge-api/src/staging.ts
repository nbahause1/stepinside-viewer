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
import { buildStagingPrompt, buildEmptyingPrompt, resolveStyle } from './staging-prompt.js';
import type { StagingStyle } from './staging-prompt.js';
import type { RateLimiter, RateLimitResult } from './ratelimit.js';
import { generateWithFalKontext, FalError } from './staging-fal.js';
import { planLayout, detectOccupied } from './staging-planner.js';
import type { LayoutPlan } from './staging-planner.js';

/** A reference furniture photo used to condition the generation. */
export interface ReferenceImage {
  mimeType: string;
  base64: string;
}

/** Dependencies injected by each entry point. */
export interface StagingDeps {
  /**
   * Which generation engine to use (defaults to 'gemini' for back-compat).
   * 'fal' = FLUX Kontext [max] multi (Track A backbone, docs/ai-virtual-staging-v2-plan.md);
   * natively places our reference furniture. 'gemini' = Nano Banana (kept as fallback).
   */
  engine?: 'gemini' | 'fal';
  /** Google Gemini API key (server-side only). Required when engine === 'gemini'. */
  geminiApiKey?: string;
  /** fal.ai API key (server-side only). Required when engine === 'fal'. */
  falApiKey?: string;
  /**
   * Room-aware layout planning (staging-planner.ts): a fast Gemini vision
   * model reads the frame and plans WHERE each piece goes before the image
   * model renders. On by default with a Gemini key; fail-soft — a planner
   * failure degrades to the un-planned prompt, never breaks staging.
   */
  enablePlanner?: boolean;
  /** Override for the plan model (default gemini-2.5-flash). */
  planModel?: string;
  /**
   * Optional ground-truth room geometry for a property (from the 3D scan's
   * room analysis) to sharpen the planner's scale reasoning.
   */
  loadRoomFacts?: (propertyId: string) => Promise<Record<string, unknown> | null>;
  rateLimiter: RateLimiter;
  /** Best-effort client IP for rate limiting; '' if unknown. */
  clientIp: string;
  /**
   * Load the reference furniture photos for a style (image-conditioning), in the
   * order the prompt expects them. Each entry point supplies this for its
   * platform (dev reads disk; prod bundles/fetches). If omitted or it returns an
   * empty array, staging falls back to the named-pieces prompt alone.
   */
  loadStyleReferences?: (style: StagingStyle) => Promise<ReferenceImage[]>;
  /**
   * Optional global daily spend cap (see KvDailyBudget in ratelimit.ts). It is
   * consumed AFTER the per-IP rate limit and input validation pass, immediately
   * before the paid Gemini call — so rejected/garbage requests never burn
   * budget. When omitted (dev server, Vercel, no KV), no cap is enforced.
   */
  dailyBudget?: { consume(): Promise<RateLimitResult> };
}

/** A normalized result the entry points translate into their native response. */
export interface StagingResult {
  status: number;
  body: Record<string, unknown>;
  retryAfterSeconds?: number;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Nano Banana Pro. We use the Pro image model (over 3.1-flash) because it holds
// the room architecture far tighter — windows/doors/walls stay pixel-stable —
// which the scan<->furnished toggle depends on: a furnished frame whose room
// drifted no longer lines up with the live scan underneath it. Costs more
// time/$ than flash; the fidelity is worth it for this feature.
const GEMINI_MODEL = 'gemini-3-pro-image';

// Output resolution requested via generationConfig.imageConfig (Gemini 3 image
// models support '1K' | '2K' | '4K'). 2K closely matches the scan's crispness.
const GEMINI_IMAGE_SIZE = '2K';

// Nano Banana Pro intermittently returns 503 ("model is overloaded" / high
// demand) — a transient condition, not a real failure. Since the viewer
// pre-generates in the background, a couple of automatic retries make that
// invisible to the visitor. Backoff before each retry (ms); the length of this
// array is the number of RETRIES (so total attempts = length + 1).
const GEMINI_RETRY_BACKOFF_MS = [2000, 5000];
// Statuses worth retrying: transient upstream overload/unavailability only.
// 429 (quota) and 4xx (bad request/key) are not retried — they won't self-heal.
const GEMINI_RETRYABLE_STATUS = new Set([503, 500]);

// Hard ceiling on a single upstream generate call. Pro-model image generation
// legitimately takes tens of seconds (2K output + high upstream load can push a
// single call past 75s — seen live), and an occupied room does TWO calls back to
// back (empty then furnish), so give each generous headroom. Past this it's a
// hung connection; on abort we surface the existing 502 path (friendly German
// message in the viewer).
const GEMINI_TIMEOUT_MS = 120_000;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** `fetch` with an AbortController deadline; the timer is always cleared. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

  // 2b. Global daily spend cap (kill-switch). Checked after rate limit +
  //     validation so only requests that would actually reach Gemini consume
  //     budget. 429 keeps the viewer's existing friendly handling.
  if (deps.dailyBudget) {
    const budget = await deps.dailyBudget.consume();
    if (!budget.allowed) {
      return {
        status: 429,
        body: { error: 'The daily staging budget is exhausted. Please try again tomorrow.' },
        retryAfterSeconds: budget.retryAfterSeconds,
      };
    }
  }

  // 3. Resolve the style id to a server-owned prompt (client never sends text)
  //    and load that style's reference furniture photos (image-conditioning).
  const style = resolveStyle(request.style);
  let references: ReferenceImage[] = [];
  try {
    references = (await deps.loadStyleReferences?.(style)) ?? [];
  } catch (err) {
    // Missing references shouldn't fail staging — degrade to the prompt alone.
    console.warn('[staging] reference load failed:', String(err));
  }

  // 3b. Engine + key selection. Validate the key ONCE up front so both the
  //     emptying pre-pass and the staging render share it.
  const engine = deps.engine ?? 'gemini';
  if (engine === 'fal' ? !deps.falApiKey : !deps.geminiApiKey) {
    return { status: 502, body: { error: 'The staging service is misconfigured.' } };
  }

  const aspectRatio = pickAspectRatio(request.width, request.height);
  // The frame the planner reads and the staging step furnishes. For an occupied
  // room it is replaced below by the AI-emptied frame (same architecture-freeze,
  // so it still lines up with the live scan).
  let frameBase64 = request.imageBase64;
  let frameMime: 'image/jpeg' | 'image/png' = request.mimeType;

  try {
    // 3c. Decide whether the room needs emptying. An explicit flag (from
    //     onboarding knowledge) always wins; otherwise AUTO-DETECT from the
    //     frame with a fast Gemini vision call. Fail-soft: default to "empty"
    //     (skip the pass) when detection is unavailable or fails.
    let occupied = request.occupied;
    if (occupied === undefined) {
      occupied = (engine === 'gemini' && deps.geminiApiKey)
        ? (await detectOccupied(deps.geminiApiKey, { mimeType: frameMime, base64: frameBase64 }, { model: deps.planModel })) ?? false
        : false;
      console.log(`[staging] auto-detected room as ${occupied ? 'FURNISHED -> emptying first' : 'empty'}`);
    }

    // 3d. EMPTYING PRE-PASS (occupied rooms only). Removes the movable contents
    //     while freezing the architecture, so the emptied frame is a clean plate
    //     for the normal staging step. Fail-soft: if it yields nothing we stage
    //     the original frame (the staging prompt still tries to clear furniture).
    if (occupied) {
      const emptied = await generateImage(engine, deps, buildEmptyingPrompt(), frameBase64, frameMime, aspectRatio, []);
      const parsed = emptied ? parseImageDataUrl(emptied) : null;
      if (parsed) {
        frameBase64 = parsed.base64;
        frameMime = parsed.mimeType;
      } else {
        console.warn('[staging] emptying pass produced no usable image - staging the original furnished frame');
      }
    }

    // 3e. Room-aware layout plan ("the brain") on the (possibly emptied) frame:
    //     a fast vision model detects windows/doors and decides WHERE each piece
    //     goes. Strictly fail-soft: null just means the render runs un-planned.
    let plan: LayoutPlan | null = null;
    if ((deps.enablePlanner ?? true) && engine === 'gemini' && deps.geminiApiKey) {
      let roomFacts: Record<string, unknown> | null = null;
      try {
        roomFacts = (await deps.loadRoomFacts?.(request.propertyId)) ?? null;
      } catch {
        roomFacts = null;
      }
      plan = await planLayout(
        deps.geminiApiKey,
        { mimeType: frameMime, base64: frameBase64 },
        style.planPieces,
        { model: deps.planModel, roomFacts },
      );
      if (!plan) {
        console.warn('[staging] planner unavailable - rendering without a layout plan');
      }
    }
    const prompt = buildStagingPrompt(style, plan);

    // 4/5. Generate + extract the inline furnished image on the configured engine.
    const image = await generateImage(engine, deps, prompt, frameBase64, frameMime, aspectRatio, references);
    if (!image) {
      return { status: 502, body: { error: 'No image was generated. Please try again.' } };
    }
    // `occupied` reports what the pipeline decided (esp. useful when auto-detected).
    return { status: 200, body: { image, style: style.id, occupied } };
  } catch (err) {
    if (err instanceof FalError) {
      console.warn(`[staging] fal ${err.status}:`, err.detail.slice(0, 600));
      if (err.status === 429) {
        return { status: 429, body: { error: 'Upstream rate limit. Please retry shortly.' }, retryAfterSeconds: 30 };
      }
      if (err.status === 401 || err.status === 403 || err.status === 422) {
        // Bad key or malformed request on our side.
        return { status: 502, body: { error: 'The staging service is misconfigured.' } };
      }
    } else if (err instanceof GeminiError) {
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

/**
 * Run one image generation on the configured engine — shared by the emptying
 * pre-pass and the staging render so both take the identical path. The API key
 * is validated by the caller before this is reached.
 */
async function generateImage(
  engine: 'gemini' | 'fal',
  deps: StagingDeps,
  prompt: string,
  base64: string,
  mimeType: string,
  aspectRatio: string,
  references: ReferenceImage[],
): Promise<string | null> {
  if (engine === 'fal') {
    return generateWithFalKontext(deps.falApiKey!, prompt, base64, mimeType, aspectRatio, references);
  }
  return generateWithGemini(deps.geminiApiKey!, prompt, base64, mimeType, aspectRatio, references);
}

/** Parse a `data:image/...;base64,...` URL into parts, or null if unparseable. */
function parseImageDataUrl(dataUrl: string): { mimeType: 'image/jpeg' | 'image/png'; base64: string } | null {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!m || m[2].length === 0) return null;
  // Downstream generation only handles jpeg/png; treat anything else as png.
  const mimeType = m[1].toLowerCase() === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return { mimeType, base64: m[2] };
}

/** Carries the upstream HTTP status + detail so the core can map errors. */
class GeminiError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`Gemini ${status}`);
    this.name = 'GeminiError';
  }
}

/**
 * Call Gemini's image model with the prompt, the captured frame (image 1) and
 * the style's reference photos (images 2..N) inline, and return the first
 * generated image as a `data:` URL (or null if none came back).
 */
async function generateWithGemini(
  apiKey: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  aspectRatio: string,
  references: ReferenceImage[] = [],
): Promise<string | null> {
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`;
  const parts = [
    { text: prompt },
    // Image 1: the room to furnish (the captured scan frame).
    { inline_data: { mime_type: mimeType, data: imageBase64 } },
    // Images 2..N: the style's reference furniture, in prompt order.
    ...references.map(r => ({ inline_data: { mime_type: r.mimeType, data: r.base64 } })),
  ];
  const requestBody = JSON.stringify({
    contents: [{ parts }],
    // Gemini 3 image models: request a high-res output at the frame's aspect.
    generationConfig: {
      imageConfig: { imageSize: GEMINI_IMAGE_SIZE, aspectRatio },
    },
  });

  // Call with automatic retries on transient upstream overload (503/500). Each
  // attempt re-issues the full request; non-retryable statuses throw immediately.
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      }, GEMINI_TIMEOUT_MS);
    } catch (err) {
      // A deadline hit means the upstream is hung/overloaded — don't retry
      // (another 75s wait helps nobody); surface the 502 path immediately.
      // Matched by name: abort surfaces as DOMException, which is not
      // `instanceof Error` on every runtime this core targets.
      if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') {
        throw new GeminiError(504, `upstream timeout after ${GEMINI_TIMEOUT_MS} ms`);
      }
      throw err;
    }

    if (res.ok) break;

    const retryable = GEMINI_RETRYABLE_STATUS.has(res.status);
    if (retryable && attempt < GEMINI_RETRY_BACKOFF_MS.length) {
      const wait = GEMINI_RETRY_BACKOFF_MS[attempt];
      console.warn(`[staging] Gemini ${res.status} (transient), retry ${attempt + 1}/${GEMINI_RETRY_BACKOFF_MS.length} in ${wait}ms`);
      await delay(wait);
      continue;
    }
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
