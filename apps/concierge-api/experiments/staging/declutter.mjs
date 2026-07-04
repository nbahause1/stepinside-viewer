// Component 2 — DECLUTTER: empty an already-furnished room so arbitrary
// customer scans can be re-staged from a clean slate. Nano Banana Pro
// (gemini-3-pro-image) removes ALL furniture/rugs/clutter and returns the
// SAME room EMPTY with architecture + camera pixel-identical.
//   node --env-file=.dev.vars declutter.mjs <frame.jpg>
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Missing GEMINI_API_KEY in .dev.vars'); process.exit(1); }
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';  // Nano Banana Pro

const frame = process.argv[2];
if (!frame) { console.error('Usage: node --env-file=.dev.vars declutter.mjs <frame.jpg>'); process.exit(1); }
const OUT = 'staging-refs/_out/decluttered.png';

// ---- same request helper shape as vlm-nano-stage.mjs ----
const gen = async (model, parts, generationConfig) => {
  const r = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], ...(generationConfig ? { generationConfig } : {}) }),
  });
  if (!r.ok) { console.error(`${model} ${r.status}:`, (await r.text()).slice(0, 500)); process.exit(1); }
  return r.json();
};
const inlineOf = async p => ({ inline_data: { mime_type: p.endsWith('.png') ? 'image/png' : 'image/jpeg', data: (await readFile(p)).toString('base64') } });

// ---- Nano Banana Pro empties the room ----
const declutterPrompt = `You are a professional real-estate photo editor. Image 1 is a furnished room. Produce the EXACT same room but COMPLETELY EMPTY.
Remove ALL furniture, sofas, chairs, tables, beds, shelves, rugs, curtains that are not part of the architecture, plants, lamps, wall art, electronics, boxes and every piece of clutter. Reconstruct any floor, wall or baseboard area that was hidden behind the removed objects so the surfaces are continuous and clean.
Freeze the architecture: keep every window, door, wall, ceiling, moulding, radiator, built-in fixture and the floor material/pattern pixel-identical to image 1. Keep the SAME camera angle, framing, lens, perspective, lighting and daylight. Do not move, rotate or crop anything.
Photorealistic interior real-estate photograph of an empty room, natural even lighting, accurate shadows, not a 3D render, no text, no watermark, no people.`;

const parts = [{ text: declutterPrompt }, await inlineOf(frame)];
console.log('decluttering with', IMAGE_MODEL, '(Nano Banana Pro)…');
const t0 = Date.now();
const imgRes = await gen(IMAGE_MODEL, parts, { imageConfig: { imageSize: '2K', aspectRatio: '16:9' } });

await mkdir('staging-refs/_out', { recursive: true });
let saved = false;
for (const c of imgRes.candidates ?? []) for (const p of c.content?.parts ?? []) {
  const inline = p.inlineData ?? p.inline_data; const b64 = inline?.data;
  if (b64) { await writeFile(OUT, Buffer.from(b64, 'base64')); saved = true; break; }
}
console.log(saved ? `SAVED -> ${OUT} (${((Date.now()-t0)/1000).toFixed(1)}s)` : 'No image returned: ' + JSON.stringify(imgRes).slice(0, 400));
if (!saved) process.exit(1);
