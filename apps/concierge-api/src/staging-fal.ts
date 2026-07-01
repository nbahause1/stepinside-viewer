/**
 * Staging engine: FLUX.1 Kontext [max] multi via fal.ai.
 *
 * The managed-API backbone for "Möbliert sehen" (Track A of the v2 plan,
 * docs/ai-virtual-staging-v2-plan.md). Unlike Gemini, Kontext natively places our
 * exact Vitra/USM reference furniture from image inputs. Same shape as
 * `generateWithGemini`: takes the captured empty-room frame + the style's
 * reference photos, returns the furnished image as a `data:` URL.
 *
 * The multi endpoint accepts 1–4 input images total, so we send the room + up to
 * 3 references (the hero pieces). FAL_KEY lives server-side only.
 */
import type { ReferenceImage } from './staging.js';

// Synchronous endpoint (returns the result inline, no polling).
const FAL_ENDPOINT = 'https://fal.run/fal-ai/flux-pro/kontext/max/multi';
// The multi endpoint hard-caps total input images at 4 (room + 3 refs).
const MAX_TOTAL_IMAGES = 4;
// Aspect ratios the endpoint accepts.
const FAL_ASPECTS = new Set(['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21']);

/** Carries the upstream HTTP status + detail so the core can map errors. */
export class FalError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`fal ${status}`);
    this.name = 'FalError';
  }
}

/** Map our aspect label to one the endpoint accepts (fallback by orientation). */
function mapAspect(aspectRatio: string): string {
  if (FAL_ASPECTS.has(aspectRatio)) return aspectRatio;
  const [w, h] = aspectRatio.split(':').map(Number);
  if (!w || !h) return '16:9';
  return w >= h ? '16:9' : '9:16';
}

/**
 * Furnish the captured frame with the style's reference pieces via FLUX Kontext.
 * Returns the first generated image as a `data:` URL (or null if none came back).
 */
export async function generateWithFalKontext(
  falApiKey: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  aspectRatio: string,
  references: ReferenceImage[] = [],
): Promise<string | null> {
  // Image 1 = the room; images 2..N = reference furniture (capped to the limit).
  const image_urls = [
    `data:${mimeType};base64,${imageBase64}`,
    ...references
      .slice(0, MAX_TOTAL_IMAGES - 1)
      .map(r => `data:${r.mimeType};base64,${r.base64}`),
  ];

  const res = await fetch(FAL_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Key ${falApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_urls,
      guidance_scale: 3.5,
      aspect_ratio: mapAspect(aspectRatio),
      // no seed: let each call vary so the candidate-generation step (v2 §4) has variety
    }),
  });

  if (!res.ok) {
    throw new FalError(res.status, await res.text().catch(() => ''));
  }

  const data = (await res.json()) as { images?: { url?: string }[] };
  const url = data.images?.[0]?.url;
  if (!url) return null;

  // fal returns a hosted (expiring) URL; inline it as a data URL so the response
  // is self-contained and identical in shape to the Gemini path.
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new FalError(imgRes.status, 'failed to fetch generated image');
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return `data:${contentType};base64,${buf.toString('base64')}`;
}
