// Full Gemini pipeline: Gemini VLM plans the layout -> Nano Banana Pro
// (gemini-3-pro-image) renders the staged image with our reference furniture.
//   node --env-file=.dev.vars vlm-nano-stage.mjs
import { readFile, writeFile } from 'node:fs/promises';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Missing GEMINI_API_KEY in .dev.vars'); process.exit(1); }
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PLAN_MODEL = process.env.GEMINI_PLAN_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';  // Nano Banana Pro

const frame = 'staging-frame.jpg';
const REFS = ['anagram-sofa.jpg', 'eames-lounge-chair.jpg', 'noguchi-coffee-table.jpg', 'vitra-akari-lamp.png']
  .map(f => `staging-refs/set1-vitra-klassiker/${f}`);
const openings = JSON.parse(await readFile('staging-refs/_out/layout-plan.json', 'utf8')).keepClear ?? [];

const gen = async (model, parts, generationConfig) => {
  const r = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], ...(generationConfig ? { generationConfig } : {}) }),
  });
  if (!r.ok) { console.error(`${model} ${r.status}:`, (await r.text()).slice(0, 500)); process.exit(1); }
  return r.json();
};
const inlineOf = async p => ({ inline_data: { mime_type: p.endsWith('.png') ? 'image/png' : 'image/jpeg', data: (await readFile(p)).toString('base64') } });

// ---- 1. Gemini plans the layout ----
const planPrompt = `You are an expert real-estate stager. Image 1 is an EMPTY living room from a high angle. Detected openings (keep clear): ${JSON.stringify(openings)}.
Plan a tasteful layout using: a 3-seat sofa, a lounge chair with ottoman, a coffee table, a floor lamp. Use the room's actual geometry; never block windows/doors; sofa flat against the longest solid wall; keep a walking path; realistic scale.
Return ONLY JSON: {"pieces":[{"item":"...","wall":"left|right|back|center","placement":"...","orientation":"..."}],"keep_clear":["..."]}`;
const planRes = await gen(PLAN_MODEL, [{ text: planPrompt }, await inlineOf(frame)], { responseMimeType: 'application/json', temperature: 0.4 });
const plan = JSON.parse(planRes.candidates?.[0]?.content?.parts?.[0]?.text);
await writeFile('staging-refs/_out/layout-plan-nano.json', JSON.stringify(plan, null, 2));
console.log('=== PLAN ===\n' + JSON.stringify(plan, null, 1));

// ---- 2. Nano Banana Pro renders it with our exact furniture ----
const sidePhrase = { left: 'the left-hand wall', right: 'the right-hand wall', back: 'the far back wall', center: 'the centre of the room' };
const lines = plan.pieces.map(p => `- ${p.item.replace(/_/g, ' ')}: against ${sidePhrase[p.wall] || p.wall}, ${p.placement}, ${p.orientation || ''}`).join('\n');
const imgPrompt = `You are a professional real-estate home stager. Image 1 is the empty room to furnish; images 2-5 are the EXACT designer pieces (use only the furniture item, ignore its background). Reproduce each faithfully (Vitra Anagram terracotta sofa, black-leather Eames Lounge Chair + ottoman, Noguchi glass coffee table, Akari washi floor lamp).
Furnish the room EXACTLY per this plan:
${lines}
Keep clear: ${plan.keep_clear.join('; ')}. Never place furniture in front of windows or doors. Freeze the architecture: keep every window, door, wall, moulding and the herringbone parquet pixel-identical to image 1, same camera angle and daylight. Photorealistic interior real-estate photograph, soft accurate contact shadows, not a 3D render, no text, no watermark.`;

const parts = [{ text: imgPrompt }, await inlineOf(frame)];
for (const r of REFS) parts.push(await inlineOf(r));
console.log('\nrendering with', IMAGE_MODEL, '(Nano Banana Pro)…');
const t0 = Date.now();
const imgRes = await gen(IMAGE_MODEL, parts, { imageConfig: { imageSize: '2K', aspectRatio: '16:9' } });
let saved = false;
for (const c of imgRes.candidates ?? []) for (const p of c.content?.parts ?? []) {
  const inline = p.inlineData ?? p.inline_data; const b64 = inline?.data;
  if (b64) { await writeFile('staging-refs/_out/guided-stage-nano.png', Buffer.from(b64, 'base64')); saved = true; break; }
}
console.log(saved ? `SAVED -> staging-refs/_out/guided-stage-nano.png (${((Date.now()-t0)/1000).toFixed(1)}s)` : 'No image returned: ' + JSON.stringify(imgRes).slice(0, 400));
