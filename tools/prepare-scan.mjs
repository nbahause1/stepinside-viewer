#!/usr/bin/env node
// StepInside scan preparation pipeline — turns a raw Gaussian-splat capture
// into the deployable viewer asset set. Validated on the demo Altbau scan
// (5.54M -> 2.91M splats, -47%, visually identical; balcony seen through the
// window preserved because we deliberately do NOT cluster-crop).
//
//   node tools/prepare-scan.mjs <input.ply|.sog|.compressed.ply> <output-dir>
//
// Output layout (matches what the viewer expects, see apps/viewer/src/index.html):
//   <output-dir>/scene/lod-meta.json (+ tiles)  — streamed LOD tree (WebGPU path)
//   <output-dir>/scene-light.sog                — SH0 single file (WebGL fallback path)
//
// Steps:
//   1. prune:  filter-nan + GPU filter-floaters (defaults) + opacity > 0.02
//              (floaters/invisible splats out; visible through-window content stays)
//   2. LODs:   decimate pruned to 50% / 25% / 10%
//   3. bundle: streamed SOG (lod-meta.json), levels 0-3
//   4. light:  SH band 0 + 50% decimation -> single .sog for non-WebGPU devices
//
// Requires a GPU (filter-floaters + SOG compression); ~3-4 min for a 5M-splat room.
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
    console.error('usage: node tools/prepare-scan.mjs <input.ply|.sog> <output-dir>');
    process.exit(1);
}

const ST = 'npx --yes @playcanvas/splat-transform';
const tmp = join(tmpdir(), `prepare-scan-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(outDir, { recursive: true });

const run = (label, cmd) => {
    console.log(`\n=== ${label} ===`);
    execSync(cmd, { stdio: 'inherit' });
};
const mb = p => `${(statSync(p).size / 1e6).toFixed(1)} MB`;

const pruned = join(tmp, 'pruned.compressed.ply');
run('1/4 prune (nan + floaters + opacity)',
    `${ST} -w "${input}" --filter-nan --filter-floaters -V opacity,gt,0.02 "${pruned}"`);

const lods = [null];
for (const [i, pct] of [[1, '50%'], [2, '25%'], [3, '10%']]) {
    const f = join(tmp, `lod${i}.compressed.ply`);
    run(`2/4 decimate LOD${i} (${pct})`, `${ST} -w -q "${pruned}" -F ${pct} "${f}"`);
    lods[i] = f;
}

const sceneDir = join(outDir, 'scene');
run('3/4 bundle streamed LOD tree',
    `${ST} -w "${pruned}" -l 0 "${lods[1]}" -l 1 "${lods[2]}" -l 2 "${lods[3]}" -l 3 "${join(sceneDir, 'lod-meta.json')}"`);

const light = join(outDir, 'scene-light.sog');
run('4/4 light scan (SH0, 50%)', `${ST} -w -q "${pruned}" -H 0 -F 50% "${light}"`);

rmSync(tmp, { recursive: true, force: true });

const meta = JSON.parse(readFileSync(join(sceneDir, 'lod-meta.json'), 'utf8'));
console.log('\n=== DONE ===');
console.log(`LOD levels: ${JSON.stringify(meta.counts)} (total stored ${meta.count})`);
console.log(`light scan: ${mb(light)}`);
console.log(`\nDeploy: copy "${sceneDir}" and "${light}" next to the viewer's index.html.`);
console.log('Verify on-device before making it the default (?content=./scene/lod-meta.json).');
