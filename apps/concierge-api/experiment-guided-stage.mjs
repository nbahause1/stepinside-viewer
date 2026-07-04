// EXPERIMENT: does our fused layout plan actually improve placement?
// Feed FLUX Kontext the frame + our furniture refs + spatial instructions derived
// from layout-plan.json (sofa wall, keep-clear openings), and compare to unguided.
//   node --env-file=.dev.vars experiment-guided-stage.mjs
import { readFile, writeFile } from 'node:fs/promises';

const key = process.env.FAL_KEY;
const A = '.';
const plan = JSON.parse(await readFile('staging-refs/_out/layout-plan.json', 'utf8'));
const REFS = ['anagram-sofa.jpg','eames-lounge-chair.jpg','noguchi-coffee-table.jpg']
  .map(f => `staging-refs/set1-vitra-klassiker/${f}`);

// image-relative phrasing (drone frame): right/left/back wall
const side = { right: 'the right-hand wall', left: 'the left-hand wall', back: 'the far back wall' };
const clear = plan.keepClear.map(k => {
  const parts = []; if (k.window) parts.push('windows'); if (k.door) parts.push('door');
  return `${parts.join(' and ')} on ${side[k.wall] || k.wall}`;
}).join('; ');

const PROMPT = `You are a professional real-estate home stager. Image 1 is an empty living room from a high angle; images 2-4 are the exact designer pieces to use (use only the furniture, ignore backgrounds).
Place them respecting the room layout:
- the Vitra Anagram terracotta sofa flat against ${side[plan.sofaWall]}, facing into the room;
- the Noguchi glass coffee table centred in front of the sofa on a low rug;
- the black-leather Eames lounge chair angled toward the seating.
CRITICAL placement rules: keep completely clear and unobstructed: ${clear}. Do not place any furniture in front of windows or doors. Keep every window, door, wall and the herringbone parquet exactly as in image 1, same camera angle. Photorealistic real-estate photo, soft contact shadows, not a render.`;

const mimeOf = p => p.endsWith('.png') ? 'image/png' : 'image/jpeg';
const uri = async p => `data:${mimeOf(p)};base64,${(await readFile(p)).toString('base64')}`;
const image_urls = [await uri('staging-frame.jpg')];
for (const r of REFS) image_urls.push(await uri(r));

console.log('plan:', JSON.stringify(plan));
console.log('generating layout-guided staging…');
const res = await fetch('https://fal.run/fal-ai/flux-pro/kontext/max/multi', {
  method: 'POST', headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: PROMPT, image_urls, guidance_scale: 3.5, aspect_ratio: '16:9', seed: 7 }),
});
if (!res.ok) { console.error(res.status, (await res.text()).slice(0, 500)); process.exit(1); }
const url = (await res.json()).images?.[0]?.url;
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
await writeFile('staging-refs/_out/guided-stage.png', buf);
console.log('SAVED -> staging-refs/_out/guided-stage.png', buf.length, 'bytes');
