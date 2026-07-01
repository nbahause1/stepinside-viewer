// Validate SOGS means decoding on ONE tile: decode means_l+means_u -> positions,
// dequantize with meta mins/maxs, and check the decoded bounds match meta (proof
// the decode is correct before scaling to the whole scene / room analysis).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCENE = 'C:/Users/Hauke/projekte/stepinside-viewer/apps/website/public/viewer/scene';
const TMP = 'C:/Users/Hauke/AppData/Local/Temp/claude/C--Users-Hauke/b41ecaa8-1d54-4416-b8bb-8367edb5db20/scratchpad';
const FF = 'C:/Users/Hauke/projekte/stepinside-viewer/apps/trailer-render/node_modules/ffmpeg-static/ffmpeg.exe';
const tile = process.argv[2] || '0_0';

const meta = JSON.parse(readFileSync(join(SCENE, tile, 'meta.json'), 'utf8'));
const { count } = meta;
const { mins, maxs } = meta.means;

function decodeRGBA(webp) {
  const out = join(TMP, 'dec.raw');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', webp, '-f', 'rawvideo', '-pix_fmt', 'rgba', out]);
  return readFileSync(out);
}

const lo = decodeRGBA(join(SCENE, tile, 'means_l.webp'));
const hi = decodeRGBA(join(SCENE, tile, 'means_u.webp'));
console.log(`tile ${tile}: count=${count}  raw pixels lo=${lo.length / 4} hi=${hi.length / 4}`);

const dmin = [Infinity, Infinity, Infinity];
const dmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < count; i++) {
  for (let c = 0; c < 3; c++) {
    const v16 = hi[i * 4 + c] * 256 + lo[i * 4 + c];
    const norm = v16 / 65535;
    const p = mins[c] + norm * (maxs[c] - mins[c]);
    if (p < dmin[c]) dmin[c] = p;
    if (p > dmax[c]) dmax[c] = p;
  }
}
const f = a => a.map(v => v.toFixed(3)).join(', ');
console.log('meta mins:', f(mins), '| decoded min:', f(dmin));
console.log('meta maxs:', f(maxs), '| decoded max:', f(dmax));
const ok = dmin.every((v, c) => Math.abs(v - mins[c]) < 0.05) && dmax.every((v, c) => Math.abs(v - maxs[c]) < 0.05);
console.log(ok ? 'DECODE OK ✅ (bounds match meta)' : 'MISMATCH ❌ (encoding is different than assumed)');
