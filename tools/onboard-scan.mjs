#!/usr/bin/env node
// StepInside one-shot onboarding — a raw customer scan becomes a live viewer
// URL in one command. Orchestrates prepare-scan (raw -> asset set) and
// upload-scan (asset set -> R2 under {propertyId}/{version}/).
//
//   node tools/onboard-scan.mjs <input.ply|.sog> <propertyId> <version> [--no-upload]
//
// Example:
//   node tools/onboard-scan.mjs ./garage.sog garage-demo v1
//
//   --no-upload   prepare the asset set only (build dir kept, nothing pushed);
//                 use to verify on-device before spending an immutable version.
//
// The prepared asset set is written to  dist/onboard/<propertyId>/<version>/
// so a re-run is inspectable and re-uploadable without re-processing.
//
// Upload requires wrangler auth (npx wrangler login) + the stepinside-assets
// bucket. Version segments are immutable — bump the version for a re-export.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const args = process.argv.slice(2);
const noUpload = args.includes('--no-upload');
const [input, propertyId, version] = args.filter(a => a !== '--no-upload');

if (!input || !propertyId || !version) {
    console.error('usage: node tools/onboard-scan.mjs <input.ply|.sog> <propertyId> <version> [--no-upload]');
    process.exit(1);
}
if (!/^[a-z0-9-]{1,64}$/.test(propertyId)) {
    console.error('propertyId must match ^[a-z0-9-]{1,64}$ (lowercase, digits, dashes)');
    process.exit(1);
}
if (!/^v[0-9]+$/.test(version)) {
    console.error('version must look like v1, v2, ...');
    process.exit(1);
}

const outDir = join(repo, 'dist', 'onboard', propertyId, version);
mkdirSync(outDir, { recursive: true });

const step = (label, cmd, argv, opts = {}) => {
    const t0 = Date.now();
    console.log(`\n############################################################`);
    console.log(`# ${label}`);
    console.log(`############################################################`);
    const r = spawnSync(cmd, argv, { cwd: opts.cwd || repo, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
        console.error(`\n✗ ${label} failed (exit ${r.status}). Aborting.`);
        process.exit(r.status || 1);
    }
    console.log(`\n✓ ${label} — ${((Date.now() - t0) / 1000).toFixed(0)}s`);
};

const wallStart = Date.now();

step('PREPARE  raw scan -> asset set',
    'node', ['tools/prepare-scan.mjs', `"${input}"`, `"${outDir}"`]);

// Geometry -> per-scan settings.json (start camera, 3 drone views, room facts).
// Runs the viewer's OWN collision code headless via tsx (installed in apps/viewer),
// so imports of ../src/collision resolve; house constants come from a base
// settings template (the live demo's non-spatial fields), scan-specific spatial
// content is freshly derived. SI_BASE_SETTINGS overrides the template.
const voxelJson = join(outDir, 'scene.voxel.json');
const settingsOut = join(outDir, 'settings.json');
const baseSettings = process.env.SI_BASE_SETTINGS ||
    join(repo, 'apps', 'website', 'public', 'viewer', 'settings.json');
step('DERIVE   geometry -> settings.json',
    'npx', ['tsx', 'tools/derive-settings.mts', `"${voxelJson}"`, `"${settingsOut}"`, propertyId, `"${baseSettings}"`],
    { cwd: join(repo, 'apps', 'viewer') });

if (!noUpload) {
    step('UPLOAD   asset set -> R2',
        'node', ['tools/upload-scan.mjs', propertyId, version, `"${outDir}"`]);
}

const mins = ((Date.now() - wallStart) / 60000).toFixed(1);
const base = `https://stepinside-assets.stepinside.workers.dev/${propertyId}/${version}`;
console.log(`\n============================================================`);
console.log(`✓ ONBOARDING COMPLETE in ${mins} min`);
console.log(`============================================================`);
console.log(`Asset set:   ${outDir}`);
if (noUpload) {
    console.log(`\nNot uploaded (--no-upload). Verify locally, then:`);
    console.log(`  node tools/upload-scan.mjs ${propertyId} ${version} ${outDir}`);
    console.log(`\nLocal test:  viewer  ?assets=<local-url>&settings=<local-url>/settings.json`);
} else {
    console.log(`R2 base:     ${base}`);
    console.log(`\nLive viewer:  <viewer-url>?assets=${base}&settings=${base}/settings.json`);
}
