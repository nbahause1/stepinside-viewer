// FUSION: 3D free-space (walls solid vs open) + 2D openings (windows/doors) ->
// decide the sofa wall + a room-aware placement zone, drawn on the drone frame.
// Uses the FIXED staging viewpoint (aerialViews[0]): image-left = one long wall,
// image-right = the other, image-back(top-centre) = far wall.
//
//   node --env-file=.dev.vars fuse-layout.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const FAL = 'https://fal.run/fal-ai/florence-2-large/open-vocabulary-detection';
const FF = '../trailer-render/node_modules/ffmpeg-static/ffmpeg.exe';
const IMG = 'staging-frame.jpg';
const OUT = 'staging-refs/_out/layout-plan.png';
const key = process.env.FAL_KEY;
if (!key) { console.error('missing FAL_KEY'); process.exit(1); }

// image dimensions (parse from ffmpeg -i)
let iw = 1536, ih = 864;
try { execFileSync(FF, ['-i', IMG], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) {
  const m = /,\s(\d{3,5})x(\d{3,5})/.exec((e.stderr || '').toString());
  if (m) { iw = +m[1]; ih = +m[2]; }
}
console.log('frame', iw, 'x', ih);

const dataUri = `data:image/jpeg;base64,${(await readFile(IMG)).toString('base64')}`;
async function detect(text) {
  const r = await fetch(FAL, { method: 'POST', headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ image_url: dataUri, text_input: text }) });
  if (!r.ok) { console.error(text, r.status); return []; }
  return ((await r.json()).results?.bboxes || []).map(b => ({ ...b, kind: text }));
}
const boxes = [...await detect('window'), ...await detect('door')];

// classify each opening to a wall by its horizontal image position
const wallOf = b => { const cx = b.x + b.w / 2; return cx < iw * 0.42 ? 'left' : cx > iw * 0.58 ? 'right' : 'back'; };
const walls = { left: { window: false, door: false }, right: { window: false, door: false }, back: { window: false, door: false } };
for (const b of boxes) { const w = wallOf(b); if (b.kind === 'window') walls[w].window = true; else walls[w].door = true; }

// sofa wall = a LONG wall (left/right) with no window; prefer the fully solid one
const sofaWall = !walls.right.window ? 'right' : (!walls.left.window ? 'left' : 'back');
const plan = {
  sofaWall,
  keepClear: Object.entries(walls).filter(([, v]) => v.window || v.door).map(([k, v]) => ({ wall: k, ...v })),
  reason: `${sofaWall} long wall is closed (no window); windows/doors kept clear.`,
};
console.log('\n=== FUSED LAYOUT PLAN ===');
console.log('walls:', JSON.stringify(walls));
console.log('sofa wall:', sofaWall);
console.log('keep clear:', JSON.stringify(plan.keepClear));
await writeFile('staging-refs/_out/layout-plan.json', JSON.stringify(plan, null, 2));

// ---- draw the plan on the frame ----
const f = [];
// openings (keep clear): window=blue, door=red
for (const b of boxes) f.push(`drawbox=x=${b.x|0}:y=${b.y|0}:w=${b.w|0}:h=${b.h|0}:color=${b.kind === 'door' ? 'red' : 'deepskyblue'}@1:t=4`);
// sofa zone against the chosen wall (image-space, floor area) in orange
const sofa = sofaWall === 'right'
  ? { x: iw * 0.56, y: ih * 0.34, w: iw * 0.40, h: ih * 0.40 }
  : sofaWall === 'left'
  ? { x: iw * 0.04, y: ih * 0.34, w: iw * 0.40, h: ih * 0.40 }
  : { x: iw * 0.30, y: ih * 0.20, w: iw * 0.40, h: ih * 0.30 };
f.push(`drawbox=x=${sofa.x|0}:y=${sofa.y|0}:w=${sofa.w|0}:h=${sofa.h|0}:color=orange@1:t=7`);
// coffee-table spot: centre of the floor
f.push(`drawbox=x=${iw*0.40|0}:y=${ih*0.55|0}:w=${iw*0.20|0}:h=${ih*0.18|0}:color=yellow@1:t=4`);

execFileSync(FF, ['-y', '-loglevel', 'error', '-i', IMG, '-vf', f.join(','), OUT]);
console.log('overlay ->', OUT, '(orange = sofa zone, yellow = table, blue = windows, red = door)');
