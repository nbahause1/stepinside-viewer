// Upload a prepared scan's assets to R2 for a property.
//
//   node tools/upload-scan.mjs <propertyId> <version> <dir>
//
// <dir> is a prepared viewer asset folder (from tools/prepare-scan.mjs) that
// contains scene-pruned/, scene-pruned-light.sog, scene.voxel.json/.bin.
// Everything is uploaded under the R2 key prefix {propertyId}/{version}/...,
// which is exactly what the viewer's ?assets= base expects and what the
// assets-cdn worker serves. Version segments are immutable — bump the version
// for a re-export, never overwrite.
//
// Example:
//   node tools/upload-scan.mjs altbau-schwabing v1 ./apps/website/public/viewer
//
// Requires wrangler auth (npx wrangler login) and the stepinside-assets bucket.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const [propertyId, version, dir] = process.argv.slice(2);
if (!propertyId || !version || !dir) {
  console.error('usage: node tools/upload-scan.mjs <propertyId> <version> <dir>');
  process.exit(1);
}
if (!/^[a-z0-9-]{1,64}$/.test(propertyId)) {
  console.error('propertyId must match ^[a-z0-9-]{1,64}$');
  process.exit(1);
}
if (!/^v[0-9]+$/.test(version)) {
  console.error('version must look like v1, v2, ...');
  process.exit(1);
}

const BUCKET = 'stepinside-assets';
const WRANGLER_CWD = join(process.cwd(), 'apps/concierge-api'); // any dir with wrangler installed

// The files/dirs that make up a servable scan. settings.json is the per-scan
// experience config (start camera, drone views, room facts) derived by
// tools/derive-settings.mts — the viewer loads it via ?settings=<base>/settings.json.
// room-facts.json (from derive-settings) is the ground-truth room geometry the
// staging planner reads via loadRoomFacts to scale furniture correctly.
const TARGETS = ['scene-pruned', 'scene-pruned-light.sog', 'scene.voxel.json', 'scene.voxel.bin', 'settings.json', 'room-facts.json'];

const contentType = (f) =>
  f.endsWith('.webp') ? 'image/webp' :
  f.endsWith('.json') ? 'application/json' :
  'application/octet-stream';

const walk = (p) => statSync(p).isDirectory()
  ? readdirSync(p).flatMap((c) => walk(join(p, c)))
  : [p];

const files = TARGETS
  .map((t) => join(dir, t))
  .filter((p) => existsSync(p))
  .flatMap(walk);

if (files.length === 0) {
  console.error(`no scan assets found under ${dir} (looked for ${TARGETS.join(', ')})`);
  process.exit(1);
}

console.log(`Uploading ${files.length} files → ${BUCKET}/${propertyId}/${version}/`);
let n = 0;
for (const file of files) {
  const rel = relative(dir, file).replace(/\\/g, '/');
  const key = `${BUCKET}/${propertyId}/${version}/${rel}`;
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', key, '--file', file, '--content-type', contentType(file), '--remote'],
    { cwd: WRANGLER_CWD, stdio: 'ignore', shell: true });
  console.log(`  [${++n}/${files.length}] ${rel}`);
}
console.log(`Done. Viewer base: ?assets=https://stepinside-assets.stepinside.workers.dev/${propertyId}/${version}`);
