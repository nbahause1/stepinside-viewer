// FULL room-aware staging pipeline, end to end, for one captured frame.
//   Stage 1: 3D room analysis (export-facts -> room-facts.json)
//   Stage 2: 2D openings + fusion (fuse-layout -> layout-plan.json)
//   Stage 3: grounded layout plan (Gemini, scale from 3D, openings from image)
//   Stage 4: render N candidates (Nano Banana Pro) + auto-score, pick best
//   node --env-file=.dev.vars run-pipeline.mjs [N]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Missing GEMINI_API_KEY in .dev.vars'); process.exit(1); }
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PLAN_MODEL = process.env.GEMINI_PLAN_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
const SCORE_MODEL = process.env.GEMINI_SCORE_MODEL || 'gemini-2.5-flash';
const N = Math.min(6, Math.max(1, parseInt(process.argv[2], 10) || 3));
const OUT = 'staging-refs/_out';
const frame = 'staging-frame.jpg';
const REFS = ['anagram-sofa.jpg', 'eames-lounge-chair.jpg', 'noguchi-coffee-table.jpg', 'vitra-akari-lamp.png']
  .map(f => `staging-refs/set1-vitra-klassiker/${f}`);

const gen = async (model, parts, generationConfig) => {
  const r = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], ...(generationConfig ? { generationConfig } : {}) }),
  });
  if (!r.ok) { console.error(`${model} ${r.status}:`, (await r.text()).slice(0, 500)); process.exit(1); }
  return r.json();
};
const inlineOf = async p => ({ inline_data: { mime_type: p.endsWith('.png') ? 'image/png' : 'image/jpeg', data: (await readFile(p)).toString('base64') } });
const stripFence = t => (t || '').replace(/```json/gi, '').replace(/```/g, '').trim();
const readImage = res => { for (const c of res.candidates ?? []) for (const p of c.content?.parts ?? []) { const b64 = (p.inlineData ?? p.inline_data)?.data; if (b64) return b64; } return null; };
const run = (label, args) => { console.log(`\n=== ${label} ===`); execFileSync('node', args, { stdio: 'inherit', cwd: process.cwd() }); };

// ---- Stage 1 + 2: analysis (produces room-facts.json + layout-plan.json) ----
run('STAGE 1/4 — 3D room analysis', ['room-analysis/export-facts.mjs']);
run('STAGE 2/4 — 2D openings + fusion', ['--env-file=.dev.vars', 'fuse-layout.mjs']);
const facts = JSON.parse(await readFile(`${OUT}/room-facts.json`, 'utf8'));
const openings = JSON.parse(await readFile(`${OUT}/layout-plan.json`, 'utf8')).keepClear ?? [];

// ---- Stage 3: grounded plan ----
console.log('\n=== STAGE 3/4 — grounded layout plan (Gemini) ===');
const planPrompt = `You are an expert real-estate stager. Image 1 is an EMPTY living room from a high angle. Windows/doors detected in the image (keep clear): ${JSON.stringify(openings)}.
GROUND-TRUTH ROOM GEOMETRY (from a 3D scan of THIS room — trust for scale and which wall is longest):
- Footprint (w x d): ${facts.footprint.width} x ${facts.footprint.depth}; floor ${facts.floor_area}, placeable ${facts.placeable_area}
- Wall lengths L/R/near/far: ${facts.wall_lengths.left}/${facts.wall_lengths.right}/${facts.wall_lengths.near}/${facts.wall_lengths.far}
The 3D scan CANNOT see glass — determine windows/doors from the IMAGE (and the list above). Place the sofa flat against the longest SOLID wall with NO windows.
Plan a tasteful layout using a 3-seat sofa, a lounge chair with ottoman, a coffee table, a floor lamp. Never block windows/doors; keep a walking path; scale to the measured walls.
Return ONLY JSON: {"pieces":[{"item":"...","wall":"left|right|back|center","placement":"...","orientation":"..."}],"keep_clear":["..."]}`;
const planRes = await gen(PLAN_MODEL, [{ text: planPrompt }, await inlineOf(frame)], { responseMimeType: 'application/json', temperature: 0.4 });
const plan = JSON.parse(stripFence(planRes.candidates?.[0]?.content?.parts?.[0]?.text));
console.log(JSON.stringify(plan, null, 1));

// ---- Stage 4: candidates + auto-score ----
console.log('\n=== STAGE 4/4 — render candidates + auto-score ===');
const sideP = { left: 'the left-hand wall', right: 'the right-hand wall', back: 'the far back wall', center: 'the centre of the room' };
const lines = plan.pieces.map(p => `- ${p.item.replace(/_/g, ' ')}: against ${sideP[p.wall] || p.wall}, ${p.placement}, ${p.orientation || ''}`).join('\n');
const imgPrompt = `You are a professional real-estate home stager. Image 1 is the empty room; images 2-5 are the EXACT designer pieces (use only the furniture, ignore backgrounds): Vitra Anagram terracotta sofa, black-leather Eames Lounge Chair + ottoman, Noguchi glass coffee table, Akari washi floor lamp.
Furnish EXACTLY per this plan:
${lines}
Keep clear: ${plan.keep_clear.join('; ')}. Never place furniture in front of windows or doors. Freeze the architecture: keep every window, door, wall, moulding and the herringbone parquet pixel-identical to image 1, same camera angle and daylight. Photorealistic real-estate photograph, soft contact shadows, not a render, no text, no watermark.`;
const scorePrompt = `You are a strict QA reviewer for AI virtual staging. Image 1 = ORIGINAL empty room; image 2 = STAGED. Openings to keep clear: ${JSON.stringify(openings)}.
Score each 1-5 (5=perfect): architecture_preserved, openings_clear, furniture_on_floor, overall. Return ONLY JSON {"architecture_preserved":n,"openings_clear":n,"furniture_on_floor":n,"overall":n,"notes":"one sentence"}`;

const frameInline = await inlineOf(frame);
const refInlines = []; for (const r of REFS) refInlines.push(await inlineOf(r));
const results = [];
for (let i = 0; i < N; i++) {
  console.log(`  [${i + 1}/${N}] rendering…`);
  const varied = `${imgPrompt}\nVariation ${i + 1} of ${N}: keep the plan+architecture; subtly vary furniture angles/spacing.`;
  const b64 = readImage(await gen(IMAGE_MODEL, [{ text: varied }, frameInline, ...refInlines], { imageConfig: { imageSize: '2K', aspectRatio: '16:9' } }));
  if (!b64) { console.error('  no image'); continue; }
  await writeFile(`${OUT}/candidate-${i + 1}.png`, Buffer.from(b64, 'base64'));
  let score; try { score = JSON.parse(stripFence((await gen(SCORE_MODEL, [{ text: scorePrompt }, frameInline, { inline_data: { mime_type: 'image/png', data: b64 } }], { responseMimeType: 'application/json', temperature: 0 })).candidates?.[0]?.content?.parts?.[0]?.text)); }
  catch { score = { overall: 0, notes: 'unparseable' }; }
  console.log(`      score overall=${score.overall} (arch=${score.architecture_preserved} open=${score.openings_clear} floor=${score.furniture_on_floor})`);
  results.push({ i: i + 1, b64, score });
}
if (!results.length) { console.error('No candidates.'); process.exit(1); }
const sub = s => (s.architecture_preserved || 0) + (s.openings_clear || 0) + (s.furniture_on_floor || 0);
results.sort((a, b) => (b.score.overall || 0) - (a.score.overall || 0) || sub(b.score) - sub(a.score));
const best = results[0];
await writeFile(`${OUT}/final-staged.png`, Buffer.from(best.b64, 'base64'));
console.log(`\n=== DONE — best = candidate ${best.i} (overall ${best.score.overall}) -> ${OUT}/final-staged.png ===`);
