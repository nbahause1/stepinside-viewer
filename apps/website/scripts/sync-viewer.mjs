// Copy the built viewer artifacts into the website's public dir.
// Cross-platform (node), because npm scripts run under cmd.exe on Windows.
//
// Copies: index.html/css/js + the hashed code-split chunks (debug panel,
// tour generator) + self-hosted fonts + settings.json. Stale hashed chunks
// in the target are removed first so old builds can't accumulate.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../viewer/public');
const dest = resolve(here, '../public/viewer');
const destFonts = join(dest, 'fonts');

// --pre: clean stale hashed chunks from the viewer's OWN output dir before a
// build (rollup never cleans, so old chunks would be swept along).
if (process.argv.includes('--pre')) {
  let removed = 0;
  if (existsSync(src)) {
    for (const f of readdirSync(src)) {
      if (/^(index-|tour-generator-).*\.js(\.map)?$/.test(f)) {
        rmSync(join(src, f));
        removed++;
      }
    }
  }
  console.log(`sync-viewer --pre: removed ${removed} stale chunks from viewer/public`);
  process.exit(0);
}

mkdirSync(destFonts, { recursive: true });

// drop stale hashed chunks
for (const f of readdirSync(dest)) {
  if (/^(index-|tour-generator-).*\.js$/.test(f)) {
    rmSync(join(dest, f));
  }
}

const copied = [];
for (const f of readdirSync(src)) {
  const isArtifact =
    f === 'index.html' || f === 'index.css' || f === 'index.js' ||
    /^(index-|tour-generator-).*\.js$/.test(f) ||
    f === 'settings.json';
  if (isArtifact) {
    copyFileSync(join(src, f), join(dest, f));
    copied.push(f);
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
