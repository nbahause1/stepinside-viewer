// Round 2: the generative model REFUSED to produce a genuinely bad staging
// (test-scorer.mjs showed it self-corrects even when explicitly told to block
// a window / float furniture). So instead of asking the model to misbehave,
// synthetically corrupt a KNOWN-GOOD render with ffmpeg (draw a solid block
// over a window) and see if the scorer's vision actually catches it.
//   node --env-file=.dev.vars test-scorer-2.mjs
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const SCORE_MODEL = process.env.GEMINI_SCORE_MODEL || 'gemini-2.5-flash';
const OUT = 'staging-refs/_out';
const frame = 'staging-frame.jpg';
const FF = '../trailer-render/node_modules/ffmpeg-static/ffmpeg.exe';
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

const scorePrompt = `You are a strict QA reviewer for AI virtual staging. Image 1 = ORIGINAL empty room; image 2 = STAGED. Openings to keep clear: ${JSON.stringify(openings)}.
Score each 1-5 (5=perfect): architecture_preserved, openings_clear, furniture_on_floor, overall. Return ONLY JSON {"architecture_preserved":n,"openings_clear":n,"furniture_on_floor":n,"overall":n,"notes":"one sentence"}`;

async function score(label, imgPath) {
  console.log(`\n=== ${label} (${imgPath}) ===`);
  const frameInline = await inlineOf(frame);
  const staged = await inlineOf(imgPath);
  let s; try { s = JSON.parse(stripFence((await gen(SCORE_MODEL, [{ text: scorePrompt }, frameInline, staged], { responseMimeType: 'application/json', temperature: 0 })).candidates?.[0]?.content?.parts?.[0]?.text)); }
  catch { s = { overall: 0, notes: 'unparseable' }; }
  console.log('  score:', JSON.stringify(s));
  return s;
}

// synthetically block the left window with a solid dark-red rectangle (mimics a sofa/wall shoved in front of it)
const goodImg = `${OUT}/final-staged.png`;
const corruptedImg = `${OUT}/test-corrupted-window.png`;
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', goodImg, '-vf', 'drawbox=x=0:y=0:w=iw*0.28:h=ih*0.7:color=0x5a2020@1:t=fill', corruptedImg]);

const good = await score('GOOD (unmodified pipeline output)', goodImg);
const corrupted = await score('CORRUPTED (window blocked with a solid block)', corruptedImg);

console.log('\n=== VERDICT ===');
console.log('good.overall      =', good?.overall, '  good.openings_clear      =', good?.openings_clear);
console.log('corrupted.overall =', corrupted?.overall, '  corrupted.openings_clear =', corrupted?.openings_clear);
if (corrupted && good && corrupted.openings_clear < good.openings_clear) console.log('PASS — scorer correctly penalizes a blocked opening.');
else console.log('FAIL — scorer did not catch an obviously blocked window. Do not trust it as a live gate yet.');
