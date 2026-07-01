// 2D window/door detection on the captured drone frame (Florence-2 open-vocab
// via fal). Feeds the layout planner: which walls have windows/doors so furniture
// isn't placed in front of them. Complements the 3D free-space map (glass is
// see-through in the splat, so 2D catches what 3D can't).
//
//   node --env-file=.dev.vars detect-openings-2d.mjs
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const FAL = 'https://fal.run/fal-ai/florence-2-large/open-vocabulary-detection';
const FF = '../trailer-render/node_modules/ffmpeg-static/ffmpeg.exe';
const IMG = 'staging-frame.jpg';
const OUT = 'staging-refs/_out/openings-2d.png';
const key = process.env.FAL_KEY;
if (!key) { console.error('missing FAL_KEY'); process.exit(1); }

const dataUri = `data:image/jpeg;base64,${(await readFile(IMG)).toString('base64')}`;

async function detect(text) {
  const r = await fetch(FAL, { method: 'POST', headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ image_url: dataUri, text_input: text }) });
  if (!r.ok) { console.error(`[${text}] ${r.status}`, (await r.text()).slice(0, 300)); return []; }
  const j = await r.json();
  return (j.results?.bboxes || []).map(b => ({ ...b, q: text }));
}

const boxes = [...await detect('window'), ...await detect('door')];
console.log(`detections (${boxes.length}):`);
for (const b of boxes) console.log(`  ${(b.label || b.q).padEnd(8)} x=${b.x|0} y=${b.y|0} w=${b.w|0} h=${b.h|0}`);
if (!boxes.length) { console.log('none'); process.exit(0); }

const filters = boxes.map(b => {
  const isDoor = (b.label || b.q).toLowerCase().includes('door');
  return `drawbox=x=${Math.round(b.x)}:y=${Math.round(b.y)}:w=${Math.round(b.w)}:h=${Math.round(b.h)}:color=${isDoor ? 'red' : 'deepskyblue'}@1:t=4`;
}).join(',');
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', IMG, '-vf', filters, OUT]);
console.log('overlay ->', OUT);
