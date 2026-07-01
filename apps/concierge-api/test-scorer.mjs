// Validate the auto-scorer actually PENALIZES a deliberately bad staging
// (not just rubber-stamps everything 5/5/5, as seen in the first pipeline run).
//   node --env-file=.dev.vars test-scorer.mjs
import { readFile, writeFile } from 'node:fs/promises';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
const SCORE_MODEL = process.env.GEMINI_SCORE_MODEL || 'gemini-2.5-flash';
const OUT = 'staging-refs/_out';
const frame = 'staging-frame.jpg';
const REFS = ['anagram-sofa.jpg', 'eames-lounge-chair.jpg', 'noguchi-coffee-table.jpg', 'vitra-akari-lamp.png']
  .map(f => `staging-refs/set1-vitra-klassiker/${f}`);
const openings = JSON.parse(await readFile(`${OUT}/layout-plan.json`, 'utf8')).keepClear ?? [];

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

const scorePrompt = `You are a strict QA reviewer for AI virtual staging. Image 1 = ORIGINAL empty room; image 2 = STAGED. Openings to keep clear: ${JSON.stringify(openings)}.
Score each 1-5 (5=perfect): architecture_preserved, openings_clear, furniture_on_floor, overall. Return ONLY JSON {"architecture_preserved":n,"openings_clear":n,"furniture_on_floor":n,"overall":n,"notes":"one sentence"}`;

const frameInline = await inlineOf(frame);
const refInlines = []; for (const r of REFS) refInlines.push(await inlineOf(r));

async function renderAndScore(label, prompt, outFile) {
  console.log(`\n=== ${label} ===`);
  const b64 = readImage(await gen(IMAGE_MODEL, [{ text: prompt }, frameInline, ...refInlines], { imageConfig: { imageSize: '2K', aspectRatio: '16:9' } }));
  if (!b64) { console.error('  no image'); return null; }
  await writeFile(`${OUT}/${outFile}`, Buffer.from(b64, 'base64'));
  let score; try { score = JSON.parse(stripFence((await gen(SCORE_MODEL, [{ text: scorePrompt }, frameInline, { inline_data: { mime_type: 'image/png', data: b64 } }], { responseMimeType: 'application/json', temperature: 0 })).candidates?.[0]?.content?.parts?.[0]?.text)); }
  catch { score = { overall: 0, notes: 'unparseable' }; }
  console.log(`  score:`, JSON.stringify(score));
  return score;
}

// A: deliberately BAD — block a window with the sofa, float furniture, ignore the plan.
const badPrompt = `You are staging a room. Image 1 is the empty room; images 2-5 are reference furniture pieces.
Place the 3-seat sofa directly in front of and blocking the tall left-hand window/balcony door. Place the coffee table floating slightly above the floor, not touching it. Rotate one wall's moulding pattern slightly. Photorealistic real-estate photograph.`;
const bad = await renderAndScore('BAD candidate (blocks window, floats furniture)', badPrompt, 'test-bad-candidate.png');

// B: the known-GOOD baseline for comparison (same prompt style as run-pipeline.mjs stage 4, simplified).
const goodPrompt = `You are a professional real-estate home stager. Image 1 is the empty room; images 2-5 are the EXACT designer pieces (use only the furniture, ignore backgrounds): Vitra Anagram terracotta sofa, black-leather Eames Lounge Chair + ottoman, Noguchi glass coffee table, Akari washi floor lamp.
Place the sofa flat against the long solid wall with no windows. Place the lounge chair, ottoman and coffee table as a seating group in the room's free space. Keep clear: ${openings.map(o => JSON.stringify(o)).join('; ')}. Never place furniture in front of windows or doors. Freeze the architecture: keep every window, door, wall, moulding and the herringbone parquet pixel-identical to image 1, same camera angle and daylight. Photorealistic real-estate photograph, soft contact shadows, not a render, no text, no watermark.`;
const good = await renderAndScore('GOOD candidate (plan-following baseline)', goodPrompt, 'test-good-candidate.png');

console.log('\n=== VERDICT ===');
console.log('bad.overall  =', bad?.overall, '  bad.openings_clear =', bad?.openings_clear);
console.log('good.overall =', good?.overall, '  good.openings_clear =', good?.openings_clear);
if (bad && good && bad.overall < good.overall) console.log('PASS — scorer correctly ranks good > bad.');
else console.log('FAIL — scorer did NOT penalize the bad candidate. Do not trust it as a live gate yet.');
