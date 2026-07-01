// Component 3 — CANDIDATES + AUTO-SCORE (reliability gate).
// Generate N staged candidates by re-running the Nano Banana Pro image step with
// DIFFERENT SEEDS, then auto-score each with a Gemini VLM text check and keep the
// best. Same request shapes as vlm-nano-stage.mjs (Gemini plans -> gemini-3-pro-image
// renders); scoring uses gemini-2.5-flash with responseMimeType 'application/json'.
//   node --env-file=.dev.vars stage-candidates.mjs [N]
import { readFile, writeFile } from 'node:fs/promises';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Missing GEMINI_API_KEY in .dev.vars'); process.exit(1); }
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PLAN_MODEL = process.env.GEMINI_PLAN_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';  // Nano Banana Pro
const SCORE_MODEL = process.env.GEMINI_SCORE_MODEL || 'gemini-2.5-flash';

const N = Math.max(1, parseInt(process.argv[2], 10) || 3);   // candidates (default 3)
const OUT = 'staging-refs/_out';

const frame = 'staging-frame.jpg';
const REFS = ['anagram-sofa.jpg', 'eames-lounge-chair.jpg', 'noguchi-coffee-table.jpg', 'vitra-akari-lamp.png']
  .map(f => `staging-refs/set1-vitra-klassiker/${f}`);
const openings = JSON.parse(await readFile(`${OUT}/layout-plan.json`, 'utf8')).keepClear ?? [];

// Exact request shape from vlm-nano-stage.mjs: contents[{parts}] (+ optional generationConfig).
const gen = async (model, parts, generationConfig) => {
  const r = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], ...(generationConfig ? { generationConfig } : {}) }),
  });
  if (!r.ok) { console.error(`${model} ${r.status}:`, (await r.text()).slice(0, 500)); process.exit(1); }
  return r.json();
};
const inlineOf = async p => ({ inline_data: { mime_type: p.endsWith('.png') ? 'image/png' : 'image/jpeg', data: (await readFile(p)).toString('base64') } });
// Same reader used for the returned image (accepts inlineData or inline_data).
const readImage = res => {
  for (const c of res.candidates ?? []) for (const p of c.content?.parts ?? []) {
    const inline = p.inlineData ?? p.inline_data; const b64 = inline?.data;
    if (b64) return b64;
  }
  return null;
};

// ---- 1. Gemini plans the layout (once; all candidates share the plan) ----
const planPrompt = `You are an expert real-estate stager. Image 1 is an EMPTY living room from a high angle. Detected openings (keep clear): ${JSON.stringify(openings)}.
Plan a tasteful layout using: a 3-seat sofa, a lounge chair with ottoman, a coffee table, a floor lamp. Use the room's actual geometry; never block windows/doors; sofa flat against the longest solid wall; keep a walking path; realistic scale.
Return ONLY JSON: {"pieces":[{"item":"...","wall":"left|right|back|center","placement":"...","orientation":"..."}],"keep_clear":["..."]}`;
const planRes = await gen(PLAN_MODEL, [{ text: planPrompt }, await inlineOf(frame)], { responseMimeType: 'application/json', temperature: 0.4 });
const plan = JSON.parse(planRes.candidates?.[0]?.content?.parts?.[0]?.text);
await writeFile(`${OUT}/layout-plan-nano.json`, JSON.stringify(plan, null, 2));
console.log('=== PLAN ===\n' + JSON.stringify(plan, null, 1));

// ---- 2. Build the Nano Banana Pro render prompt (identical to vlm-nano-stage.mjs) ----
const sidePhrase = { left: 'the left-hand wall', right: 'the right-hand wall', back: 'the far back wall', center: 'the centre of the room' };
const lines = plan.pieces.map(p => `- ${p.item.replace(/_/g, ' ')}: against ${sidePhrase[p.wall] || p.wall}, ${p.placement}, ${p.orientation || ''}`).join('\n');
const imgPrompt = `You are a professional real-estate home stager. Image 1 is the empty room to furnish; images 2-5 are the EXACT designer pieces (use only the furniture item, ignore its background). Reproduce each faithfully (Vitra Anagram terracotta sofa, black-leather Eames Lounge Chair + ottoman, Noguchi glass coffee table, Akari washi floor lamp).
Furnish the room EXACTLY per this plan:
${lines}
Keep clear: ${plan.keep_clear.join('; ')}. Never place furniture in front of windows or doors. Freeze the architecture: keep every window, door, wall, moulding and the herringbone parquet pixel-identical to image 1, same camera angle and daylight. Photorealistic interior real-estate photograph, soft accurate contact shadows, not a 3D render, no text, no watermark.`;

// The reference furniture parts are reused for every candidate render.
const renderParts = [{ text: imgPrompt }, await inlineOf(frame)];
for (const r of REFS) renderParts.push(await inlineOf(r));

// ---- 3. Auto-score prompt (Gemini VLM text check -> strict JSON) ----
const scorePrompt = `You are a strict QA reviewer for AI virtual staging. Image 1 is the ORIGINAL empty room; image 2 is the STAGED result. Detected openings that must stay clear: ${JSON.stringify(openings)}.
Judge ONLY the staged image against the original on these axes, each an integer 1-5 (5 = perfect):
- architecture_preserved: windows, doors, walls, mouldings, floor and camera angle are pixel-faithful to the original.
- openings_clear: no furniture blocks any window or door; walking paths remain open.
- furniture_on_floor: every piece sits flat on the floor with correct scale and realistic contact shadows (nothing floating, sunken or warped).
- overall: your holistic verdict on whether this is a usable, believable listing photo.
Return ONLY JSON: {"architecture_preserved":n,"openings_clear":n,"furniture_on_floor":n,"overall":n,"notes":"one short sentence"}`;

// ---- 4. Render N candidates with different seeds, then score each ----
const seeds = Array.from({ length: N }, (_, i) => 1000 + i * 1337);   // deterministic, distinct
const frameInline = await inlineOf(frame);
const results = [];
for (let i = 0; i < N; i++) {
  const seed = seeds[i];
  console.log(`\n[${i + 1}/${N}] rendering with ${IMAGE_MODEL} (Nano Banana Pro) seed=${seed}…`);
  const t0 = Date.now();
  // Exact imageConfig from vlm-nano-stage.mjs, plus a per-candidate seed to vary output.
  const imgRes = await gen(IMAGE_MODEL, renderParts, { imageConfig: { imageSize: '2K', aspectRatio: '16:9' }, seed });
  const b64 = readImage(imgRes);
  if (!b64) { console.error('  no image returned:', JSON.stringify(imgRes).slice(0, 400)); continue; }
  const path = `${OUT}/candidate-${i + 1}.png`;
  await writeFile(path, Buffer.from(b64, 'base64'));
  console.log(`  saved -> ${path} (${((Date.now() - t0) / 1000).toFixed(1)}s); scoring…`);

  // Auto-score: text-model VLM check on [original, staged], strict JSON out.
  const scoreRes = await gen(
    SCORE_MODEL,
    [{ text: scorePrompt }, frameInline, { inline_data: { mime_type: 'image/png', data: b64 } }],
    { responseMimeType: 'application/json', temperature: 0 },
  );
  let score;
  try { score = JSON.parse(scoreRes.candidates?.[0]?.content?.parts?.[0]?.text); }
  catch { score = { architecture_preserved: 0, openings_clear: 0, furniture_on_floor: 0, overall: 0, notes: 'unparseable score' }; }
  console.log(`  score: ${JSON.stringify(score)}`);
  results.push({ i: i + 1, seed, path, b64, score });
}

if (!results.length) { console.error('No candidates were generated.'); process.exit(1); }

// ---- 5. Pick the highest overall (tie-break on the sum of sub-scores) ----
const subSum = s => (s.architecture_preserved || 0) + (s.openings_clear || 0) + (s.furniture_on_floor || 0);
results.sort((a, b) => (b.score.overall || 0) - (a.score.overall || 0) || subSum(b.score) - subSum(a.score));
const best = results[0];
const bestPath = `${OUT}/best-candidate.png`;
await writeFile(bestPath, Buffer.from(best.b64, 'base64'));

console.log('\n=== ALL SCORES ===');
for (const r of results) {
  const s = r.score;
  console.log(`candidate ${r.i} (seed ${r.seed}): overall=${s.overall} arch=${s.architecture_preserved} openings=${s.openings_clear} floor=${s.furniture_on_floor} — ${s.notes || ''}`);
}
console.log(`\n=== BEST: candidate ${best.i} (seed ${best.seed}), overall=${best.score.overall} ===`);
console.log(`SAVED -> ${bestPath}`);
