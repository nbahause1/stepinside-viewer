/**
 * Layout planning ("the room-analysis brain") in front of the image model.
 *
 * A fast Gemini vision model reads the captured room frame, identifies the
 * windows/doors ITSELF (glass is invisible to the 3D scan, and the VLM catches
 * openings a dedicated detector missed — validated against Florence-2 during
 * R&D, see docs/ai-virtual-staging-v2-plan.md), and returns a compact
 * placement plan for the style's furniture set. The plan is injected into the
 * render prompt so Nano Banana Pro places pieces room-aware — sofa on a solid
 * wall, openings kept clear — instead of guessing.
 *
 * Fail-soft by design: ANY failure (timeout, quota, unparseable JSON) returns
 * null and staging proceeds with the un-planned prompt. The planner may only
 * ever improve a result, never break the feature.
 */

export interface LayoutPlanPiece {
  item: string;
  wall: string;
  placement: string;
  orientation?: string;
}

export interface LayoutPlan {
  pieces: LayoutPlanPiece[];
  keepClear: string[];
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_PLAN_MODEL = 'gemini-2.5-flash';

// The plan is a small text completion; past ~20s something is wrong upstream
// and the render step (with its own 75s budget) should not be starved.
const PLAN_TIMEOUT_MS = 20_000;

// Hygiene caps: the plan text flows into the image prompt, so bound both the
// number of entries and the length of every string.
const MAX_PIECES = 8;
const MAX_KEEP_CLEAR = 8;
const MAX_TEXT = 220;

const clip = (v: unknown): string | null => {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, MAX_TEXT) : null;
};

/** Parse + bound the model's JSON into a LayoutPlan; null when unusable. */
function parsePlan(text: string): LayoutPlan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.pieces) || obj.pieces.length === 0) return null;

  const pieces: LayoutPlanPiece[] = [];
  for (const entry of obj.pieces.slice(0, MAX_PIECES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const item = clip(e.item);
    const wall = clip(e.wall);
    const placement = clip(e.placement);
    if (!item || !wall || !placement) continue;
    const orientation = clip(e.orientation);
    pieces.push({ item, wall, placement, ...(orientation ? { orientation } : {}) });
  }
  if (pieces.length === 0) return null;

  const keepClearRaw = Array.isArray(obj.keep_clear) ? obj.keep_clear : [];
  const keepClear = keepClearRaw
    .map(clip)
    .filter((s): s is string => s !== null)
    .slice(0, MAX_KEEP_CLEAR);

  return { pieces, keepClear };
}

/**
 * Ask the plan model for a room-aware layout. `furnitureList` names the
 * style's pieces in plain words (server-owned, never client text). Optional
 * `roomFacts` (ground-truth geometry from the 3D scan) sharpen the scale
 * reasoning when a property ships them.
 */
export async function planLayout(
  apiKey: string,
  frame: { mimeType: string; base64: string },
  furnitureList: string,
  opts?: { model?: string; roomFacts?: Record<string, unknown> | null },
): Promise<LayoutPlan | null> {
  const model = opts?.model || DEFAULT_PLAN_MODEL;

  const factsBlock = opts?.roomFacts
    ? `\nGROUND-TRUTH ROOM GEOMETRY (measured from a 3D scan of THIS room — trust these numbers for SCALE and which wall is longest; windows/doors must still come from the IMAGE, the scan cannot see glass):\n${JSON.stringify(opts.roomFacts).slice(0, 1200)}\n`
    : '';

  const prompt = `You are an expert real-estate home stager. Image 1 is a room captured from a high angle. First identify every WINDOW and DOOR visible in the image — those must stay completely clear.
${factsBlock}
Plan a tasteful layout using exactly these pieces: ${furnitureList}.
Rules: place the sofa flat against the longest SOLID wall that has NO windows; never block a window, a door or the walking path through the room; scale and space the pieces plausibly for this room's size.
Return ONLY JSON: {"pieces":[{"item":"...","wall":"left|right|back|front|center","placement":"short phrase","orientation":"short phrase"}],"keep_clear":["short phrase per window/door"]}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: frame.mimeType, data: frame.base64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[staging] planner ${model} answered ${res.status}`);
      return null;
    }
    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return parsePlan(text);
  } catch (err) {
    console.warn('[staging] planner failed:', String(err).slice(0, 200));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Occupancy detection is a one-word classification; keep it snappy so it barely
// adds to the staging latency (it runs before the emptying decision).
const DETECT_TIMEOUT_MS = 12_000;

/**
 * Detect whether a room is currently FURNISHED, so the pipeline can decide on
 * its own whether to run the emptying pre-pass — no manual `occupied` flag
 * needed. Built-in fixtures (fitted kitchen, radiators, built-in wardrobes) do
 * NOT count as furnished. Fail-soft: returns null on any failure so the caller
 * can fall back to a safe default (treat as empty = no emptying pass).
 */
export async function detectOccupied(
  apiKey: string,
  frame: { mimeType: string; base64: string },
  opts?: { model?: string },
): Promise<boolean | null> {
  const model = opts?.model || DEFAULT_PLAN_MODEL;
  const prompt = `Look at this interior room photo. Is the room currently FURNISHED — does it contain movable furniture or belongings such as sofas, chairs, tables, beds, shelves, rugs, lamps, plants, wall art, boxes or clutter? Built-in fixtures (a fitted kitchen, radiators, built-in wardrobes) do NOT count. Answer ONLY JSON: {"furnished": true} or {"furnished": false}.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: frame.mimeType, data: frame.base64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[staging] occupancy detect ${model} answered ${res.status}`);
      return null;
    }
    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as { furnished?: unknown };
    return typeof parsed.furnished === 'boolean' ? parsed.furnished : null;
  } catch (err) {
    console.warn('[staging] occupancy detect failed:', String(err).slice(0, 200));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
