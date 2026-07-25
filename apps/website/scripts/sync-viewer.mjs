// Copy the built viewer artifacts into the website's public dir.
// Cross-platform (node), because npm scripts run under cmd.exe on Windows.
//
// Copies: index.html/css/js + ALL hashed code-split chunks + self-hosted fonts
// + vendor assets + settings.json. The website serves whatever is committed
// here, so a missing chunk = a broken feature in production.
//
// HARDENING (2026-07): this script used to copy only chunks matching a
// hardcoded prefix allowlist (index-|tour-generator-|maplibre-gl-). When the
// bundler emitted a chunk with a NEW prefix, it was silently NOT copied and the
// feature broke live (the maplibre-gl incident). Now we mirror EVERY .js chunk
// and, after copying, ASSERT that every `./X.js` referenced by the HTML and the
// chunks actually exists in the target — so a dropped chunk fails the build
// (locally, in CI, and on Vercel) instead of shipping.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../viewer/public');
const dest = resolve(here, '../public/viewer');
const destFonts = join(dest, 'fonts');

// A hashed, content-addressed chunk: `name-<hash>.js` (rollup default 8-char
// hash). Deliberately does NOT match the stable entry `index.js` (no hash), so
// the entry keeps its own cache policy. Any prefix matches — no allowlist.
// base64url hash alphabet includes '-', so a hash can look like `CNhu-msp`.
const isHashedChunk = (f) => /-[A-Za-z0-9_-]{8}\.js(\.map)?$/.test(f);
const isJs = (f) => f.endsWith('.js'); // any .js (entry + hashed); excludes .js.map

// --pre: clean stale hashed chunks from the viewer's OWN output dir before a
// build (rollup never cleans, so old chunks would be swept along).
if (process.argv.includes('--pre')) {
  let removed = 0;
  if (existsSync(src)) {
    for (const f of readdirSync(src)) {
      if (isHashedChunk(f)) {
        rmSync(join(src, f));
        removed++;
      }
    }
  }
  console.log(`sync-viewer --pre: removed ${removed} stale chunks from viewer/public`);
  process.exit(0);
}

mkdirSync(destFonts, { recursive: true });

// True mirror: drop EVERY stale .js/.js.map in dest first, then copy the fresh
// set from src. This alone eliminates stale-chunk accumulation; the copy loop
// below then reproduces exactly what the build emitted.
for (const f of readdirSync(dest)) {
  if (f.endsWith('.js') || f.endsWith('.js.map')) {
    rmSync(join(dest, f));
  }
}

// Named, non-hashed assets that must always ship (they have fixed URLs and are
// referenced by the HTML / runtime by exact name).
const NAMED_ASSETS = new Set([
  'index.html',
  'index.css',
  'index.js',
  'chat.html',          // standalone concierge chat page (phone handoff)
  'door-open.mp4',      // arrival film behind the boot-splash loader
  'door-open-poster.jpg', // film poster (iOS low-power: autoplay refused -> black without it)
  'settings.json',
]);

const copied = [];
for (const f of readdirSync(src)) {
  // Copy every JS chunk (entry + all hashed, any prefix) but never sourcemaps,
  // plus the named assets. `isJs` excludes `.js.map`.
  const isArtifact = NAMED_ASSETS.has(f) || isJs(f);
  if (isArtifact) {
    copyFileSync(join(src, f), join(dest, f));
    copied.push(f);
  }
}

// vendor assets (maplibre css for the surroundings map), copied like fonts
const vendorDir = join(src, 'vendor');
if (existsSync(vendorDir)) {
  const destVendor = join(dest, 'vendor');
  mkdirSync(destVendor, { recursive: true });
  for (const f of readdirSync(vendorDir)) {
    copyFileSync(join(vendorDir, f), join(destVendor, f));
    copied.push(`vendor/${f}`);
  }
}

const fontsDir = join(src, 'fonts');
if (existsSync(fontsDir)) {
  for (const f of readdirSync(fontsDir)) {
    if (f.endsWith('.woff2')) {
      copyFileSync(join(fontsDir, f), join(destFonts, f));
      copied.push(`fonts/${f}`);
    }
  }
}

console.log(`sync-viewer: copied ${copied.length} artifacts:`, copied.join(', '));

// --- Post-sync reference-integrity assertion -------------------------------
// Scan the HTML + every copied .js for local `./X.js` references (static
// imports, dynamic import(), and <script src>) and assert each target exists in
// dest. A missing target means the bundler emitted a reference to a chunk that
// did not get copied (or was never built) -> hard failure, not a silent break.
// Covers every local-chunk reference form rollup/vite + the HTML can emit:
// dynamic import("./x.js"), side-effect import"./x.js", re-export from"./x.js",
// new URL("./x.js", import.meta.url) (worker/asset chunks), and HTML
// src=/href= (script + modulepreload). A form we DON'T match = false confidence.
const REF_RE = /(?:\bimport\s*\(?|\bfrom|(?:\bsrc|\bhref)\s*=|new URL\s*\()\s*["'`]([^"'`]+?\.js)["'`]/g;
const scanTargets = readdirSync(dest).filter((f) => f.endsWith('.js') || f.endsWith('.html'));
const present = new Set(readdirSync(dest).filter((f) => f.endsWith('.js')));
const missing = new Map(); // chunk -> Set(referencedBy)

for (const f of scanTargets) {
  const text = readFileSync(join(dest, f), 'utf8');
  let m;
  while ((m = REF_RE.exec(text)) !== null) {
    const ref = m[1];
    // Only check local chunk references (start with ./ or /). Skip http(s) and
    // bare npm specifiers — those aren't files we copy, and checking them would
    // false-fail.
    if (!ref.startsWith('./') && !ref.startsWith('/')) continue;
    const name = basename(ref);
    if (!present.has(name)) {
      if (!missing.has(name)) missing.set(name, new Set());
      missing.get(name).add(f);
    }
  }
}

// A build that emitted nothing (or lost the entry) must not pass as "OK".
if (present.size === 0 || !present.has('index.js')) {
  console.error('\nsync-viewer: FAILED — no viewer chunks were copied (or index.js is missing).');
  console.error('The viewer build likely produced no output. Rebuild the viewer before syncing.\n');
  process.exit(1);
}

if (missing.size > 0) {
  console.error('\nsync-viewer: FAILED — referenced chunk(s) missing from public/viewer:');
  for (const [name, refs] of missing) {
    console.error(`  - ${name}  (referenced by: ${[...refs].join(', ')})`);
  }
  console.error(
    '\nThis is the maplibre-gl incident class: a chunk was referenced but not built/copied.\n' +
    'Check that all viewer deps are installed before the build (e.g. maplibre-gl), then rebuild.\n'
  );
  process.exit(1);
}

console.log(`sync-viewer: reference-integrity OK (${present.size} chunks, all references resolve)`);
