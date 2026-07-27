#!/usr/bin/env node
// StepInside scan preparation pipeline — turns a raw Gaussian-splat capture
// into the COMPLETE deployable viewer asset set (scene + collision).
//
//   node tools/prepare-scan.mjs <input.ply|.sog|.compressed.ply> <output-dir>
//
// Output layout — this IS the contract the viewer and upload-scan.mjs expect
// (apps/viewer/src/index.html: `${assetsBase}/scene-pruned/lod-meta.json` for
// content, `${assetsBase}/scene.voxel.json` for collision):
//
//   <output-dir>/scene-pruned/lod-meta.json (+ tiles)  — streamed LOD tree (both renderers)
//   <output-dir>/scene-pruned-light.sog                — SH0 single file (?content A/B blob)
//   <output-dir>/scene.voxel.json + scene.voxel.bin    — walk-through collision
//
// Steps:
//   1. prune:  filter-nan + GPU filter-floaters (defaults) + opacity > 0.02
//              (floaters/invisible splats out; visible through-window content stays)
//   2. LODs:   decimate pruned to 50% / 25% / 10%
//   3. bundle: streamed SOG (scene-pruned/lod-meta.json), levels 0-3
//   4. light:  SH band 0 + 50% decimation -> single .sog for ?content A/B
//   5. voxel:  interior collision — external-fill seals the outside, carve floods
//              the navigable capsule volume from an auto-detected seed (bbox
//              centre). Produces scene.voxel.json + scene.voxel.bin.
//
// Validated on the demo Altbau scan (5.54M -> 2.91M splats, -47%, visually
// identical; balcony through the window preserved because we deliberately do
// NOT cluster-crop) and on the Garage High-Detail test (13.9M raw).
//
// Requires a GPU (filter-floaters, SOG compression, voxel carve). ~3-5 min for
// a 3-5M-splat room. Override the carve seed with SI_SEED="x,y,z" if the
// auto-detected centre lands in solid geometry (rare for rooms).
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
    console.error('usage: node tools/prepare-scan.mjs <input.ply|.sog> <output-dir>');
    process.exit(1);
}

// Pin the version: splat-transform v3.x is a breaking rewrite (flags renamed,
// --decimate is .ply-only, etc.) that silently breaks this pipeline. `npx --yes`
// without a version fetches @latest, so pin @2.7.1 explicitly.
const ST = 'npx --yes @playcanvas/splat-transform@2.7.1';

// Fast mode (SI_FAST=1): for scans you've ALREADY cleaned yourself (e.g. floaters
// removed in SuperSplat). Skips the GPU floater filter (redundant + slow + the
// crash risk on big scans), drops SOG compression iterations, and skips the
// optional light fallback. Trades a little SH-compression quality for speed —
// meant for "see the result quickly", not the final production export.
const FAST = process.env.SI_FAST === '1';
const ITER = process.env.SI_ITER || (FAST ? '4' : '10');

const tmp = join(tmpdir(), `prepare-scan-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(outDir, { recursive: true });

const run = (label, cmd) => {
    console.log(`\n=== ${label} ===`);
    execSync(cmd, { stdio: 'inherit' });
};
const mb = p => `${(statSync(p).size / 1e6).toFixed(1)} MB`;

// -- 1. prune -------------------------------------------------------------
// Intermediates are PLAIN .ply on purpose: .compressed.ply quantises
// positions/attributes per 256-splat chunk, and the final SOG encode is a
// second lossy pass — that double round-trip visibly degraded a re-encoded
// .sog vs its original (verified A/B on the Studio-11 scan). Uncompressed
// intermediates cost a few hundred MB of tmp disk and keep the only lossy
// step the final SOG encode itself.
const pruned = join(tmp, 'pruned.ply');
const floaters = FAST ? '' : '--filter-floaters ';
run(`1/5 prune (nan${FAST ? '' : ' + floaters'} + opacity)`,
    `${ST} -w "${input}" --filter-nan ${floaters}-V opacity,gt,0.02 "${pruned}"`);

// -- 2. LODs --------------------------------------------------------------
const lods = [null];
for (const [i, pct] of [[1, '50%'], [2, '25%'], [3, '10%']]) {
    const f = join(tmp, `lod${i}.ply`);
    run(`2/5 decimate LOD${i} (${pct})`, `${ST} -w -q "${pruned}" -F ${pct} "${f}"`);
    lods[i] = f;
}

// -- 3. streamed LOD tree -> scene-pruned/lod-meta.json -------------------
const sceneDir = join(outDir, 'scene-pruned');
run(`3/5 bundle streamed LOD tree (i=${ITER})`,
    `${ST} -w -i ${ITER} "${pruned}" -l 0 "${lods[1]}" -l 1 "${lods[2]}" -l 2 "${lods[3]}" -l 3 "${join(sceneDir, 'lod-meta.json')}"`);

// -- 4. light single-file fallback (skipped in fast mode) ----------------
const light = FAST ? null : join(outDir, 'scene-pruned-light.sog');
if (light) run(`4/5 light scan (SH0, 50%, i=${ITER})`, `${ST} -w -q -i ${ITER} "${pruned}" -H 0 -F 50% "${light}"`);

// -- 5. voxel collision ---------------------------------------------------
// Carve needs a seed point inside the navigable free space. For a room the
// bounding-box centre is reliably interior air; derive it from the pruned
// scan's summary so this works on any scan without hand-tuning. Override with
// SI_SEED="x,y,z" for the rare scan whose centre sits in solid geometry.
const bboxCentre = () => {
    const out = execSync(`${ST} -q "${pruned}" -m null`, { encoding: 'utf8' });
    const axis = {};
    for (const line of out.split('\n')) {
        const c = line.split('|').map(s => s.trim());
        // rows look like: | x | <min> | <max> | <median> | ...
        if (['x', 'y', 'z'].includes(c[1]) && c[2] !== '' && c[3] !== '') {
            axis[c[1]] = (Number(c[2]) + Number(c[3])) / 2;
        }
    }
    if (![axis.x, axis.y, axis.z].every(Number.isFinite)) return null;
    return `${axis.x},${axis.y},${axis.z}`;
};

const seed = process.env.SI_SEED || bboxCentre() || '0,0,0';
const voxel = join(outDir, 'scene.voxel.json');
run(`5/5 voxel collision (seed ${seed})`,
    `${ST} -w "${pruned}" --voxel-external-fill --voxel-carve --seed-pos ${seed} "${voxel}"`);

rmSync(tmp, { recursive: true, force: true });

// -- summary --------------------------------------------------------------
const meta = JSON.parse(readFileSync(join(sceneDir, 'lod-meta.json'), 'utf8'));
console.log('\n=== DONE ===');
console.log(`LOD levels:  ${JSON.stringify(meta.counts)} (total stored ${meta.count})`);
if (light) console.log(`light scan:  ${mb(light)}`);
console.log(`voxel:       ${mb(voxel)} + ${mb(join(outDir, 'scene.voxel.bin'))} (carve seed ${seed})`);
console.log(`\nAsset set ready in ${outDir}`);
console.log('Deploy with:  node tools/upload-scan.mjs <propertyId> <version> ' + outDir);
console.log('Or one-shot:  node tools/onboard-scan.mjs <input> <propertyId> <version>');
