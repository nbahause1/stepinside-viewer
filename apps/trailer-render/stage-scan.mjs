// Auto-Experience pipeline — STAGE step: pre-generate the "Möbliert sehen"
// stills for a scan, fully headless, so staging is an invisible background step
// (no browser test app, no manual capture).
//
//   node apps/trailer-render/stage-scan.mjs <propertyId> [styleIds]
//
// It reproduces the LIVE staging capture EXACTLY (Weg 2): boots the real viewer
// pointed at THIS scan's assets, flies to the fixed aerial view (aerialViews[0]
// — the one derive-settings computed), grabs the canvas at postrender. That
// frame is byte-aligned with what the live viewer shows, so the furnished
// overlay lines up. Each style is sent to /stage (which auto-detects furnished,
// empties if needed, then furnishes) and saved as staged/<id>.jpg. Finally the
// scan's settings.json staging block is switched on to point at those stills.
//
// Prereqs (both already run in the Studio flow):
//   • a server serving the viewer + this scan's asset set (default: Studio :4545)
//   • the concierge /stage API (default: dev-server :8787)
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

const propertyId = process.argv[2];
if (!propertyId || !/^[a-z0-9-]{1,64}$/.test(propertyId)) {
  console.error('usage: node stage-scan.mjs <propertyId> [styleIds=classic,scandi,warm]');
  process.exit(1);
}
const STYLES = (process.argv[3] || 'classic,scandi,warm').split(',').map(s => s.trim()).filter(Boolean);
const LABELS = { classic: 'Designklassiker', scandi: 'Minimal', warm: 'Colour-Pop' };

const STUDIO = process.env.SI_STUDIO_BASE || 'http://localhost:4545';
const STAGE_API = process.env.SI_STAGE_API || 'http://localhost:8787/stage';
// SI_OUT_DIR: where staged/ images (and the settings.json update) go. Defaults to
// the onboard output. SI_NO_SETTINGS=1: only write images, leave settings.json
// alone (e.g. re-staging the live demo whose staging config already exists).
const noSettings = process.env.SI_NO_SETTINGS === '1';
const outDir = process.env.SI_OUT_DIR ? resolve(process.env.SI_OUT_DIR) : join(repo, 'dist', 'onboard', propertyId, 'v1');
const settingsPath = join(outDir, 'settings.json');
if (!noSettings && !existsSync(settingsPath)) {
  console.error(`no settings.json at ${settingsPath} — run onboard/derive first (or set SI_NO_SETTINGS=1).`);
  process.exit(1);
}

// Viewer URL for the headless capture. Override with SI_VIEWER_URL to stage an
// EXISTING scan (e.g. the live demo, loaded from its default R2 assets + site
// settings). ?scout exposes window.viewer (dev helper gated behind
// ?debug/?scout/?record, index.ts:394); the debug panel is DOM, never in the
// WebGL canvas capture. &noui hides the chrome.
const assetsBase = `${STUDIO}/out/${propertyId}/v1`;
const viewerUrl = process.env.SI_VIEWER_URL ||
  (`${STUDIO}/viewer/index.html?assets=${encodeURIComponent(assetsBase)}` +
   `&settings=${encodeURIComponent(assetsBase + '/settings.json')}&webgl&noui&scout`);

const MAX_CAPTURE_EDGE = 1536;         // matches viewer staging.ts
const WIDTH = 1920, HEIGHT = 1080;

// ---- 1. Capture the aerial frame exactly like the live viewer would --------
console.log('Capturing aerial frame (headless viewer)…');
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-gl=angle',
    '--use-angle=gl', `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
page.on('console', m => { const t = m.text(); if (/error|fail/i.test(t)) console.log('  [page]', t); });

await page.goto(viewerUrl, { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => window.viewer?.app?.graphicsDevice, { timeout: 60000 });
// Let the splat stream + paint at full quality before capture. Assets streamed
// from R2 (the live demo) need longer than a local Studio-served scan.
await new Promise(r => setTimeout(r, Number(process.env.SI_PAINT_MS) || 4000));

await page.evaluate(() => new Promise((res) => {
  const g = window.viewer;
  let done = false;
  const finish = () => { if (done) return; done = true; g.events.off('aerialArrived', on); res(); };
  const on = () => finish();
  g.events.on('aerialArrived', on);
  setTimeout(finish, 3500);
  g.events.fire('inputEvent', 'aerialGoto', 0);
}));
await new Promise(r => setTimeout(r, 1200));

const frame = await page.evaluate((MAX) => new Promise((res, rej) => {
  const app = window.viewer.app;
  app.once('postrender', () => {
    try {
      const c = app.graphicsDevice.canvas;
      if (!c.width || !c.height) throw new Error('empty canvas');
      const scale = Math.min(1, MAX / Math.max(c.width, c.height));
      const w = Math.max(1, Math.round(c.width * scale));
      const h = Math.max(1, Math.round(c.height * scale));
      const off = document.createElement('canvas'); off.width = w; off.height = h;
      const ctx = off.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(c, 0, 0, w, h);
      res({ dataUrl: off.toDataURL('image/jpeg', 0.9), w, h });
    } catch (e) { rej(String(e)); }
  });
  app.renderNextFrame = true;
}), MAX_CAPTURE_EDGE);
await browser.close();
console.log(`  frame captured (${frame.w}x${frame.h})`);

// ---- 2. Generate each style via /stage (auto-detect + empty + furnish) ------
mkdirSync(join(outDir, 'staged'), { recursive: true });
const doneStyles = [];
for (const id of STYLES) {
  process.stdout.write(`Staging "${id}" … `);
  const t0 = Date.now();
  const r = await fetch(STAGE_API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // No `occupied` → the server auto-detects furnished vs empty.
    body: JSON.stringify({ propertyId, image: frame.dataUrl, style: id, width: frame.w, height: frame.h }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.image) { console.log(`FAILED (${j.error || r.status})`); continue; }
  const b64 = j.image.replace(/^data:image\/\w+;base64,/, '');
  writeFileSync(join(outDir, 'staged', `${id}.jpg`), Buffer.from(b64, 'base64'));
  doneStyles.push({ id, label: LABELS[id] || id, image: `staged/${id}.jpg` });
  console.log(`ok — ${((Date.now() - t0) / 1000).toFixed(0)}s${j.occupied ? ' (was furnished → emptied first)' : ''}`);
}

if (doneStyles.length === 0) { console.error('no styles generated.'); process.exit(1); }

// ---- 3. Switch the scan's staging config on, pointing at the stills --------
if (noSettings) {
  console.log(`\n✓ STAGE complete — ${doneStyles.length} style(s): ${doneStyles.map(s => s.id).join(', ')}`);
  console.log(`  images: ${join(outDir, 'staged')}`);
  console.log(`  settings.json left unchanged (SI_NO_SETTINGS)`);
  process.exit(0);
}
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
// Merge with any styles staged in a previous run (new wins), so incremental
// runs accumulate instead of dropping earlier styles.
const prev = Array.isArray(settings.staging?.styles) ? settings.staging.styles : [];
const byId = new Map(prev.map(s => [s.id, s]));
for (const s of doneStyles) byId.set(s.id, s);
settings.staging = {
  ...(settings.staging || {}),
  enabled: true,
  mode: 'demo',                       // pre-generated stills → no per-view API cost
  propertyId,
  styles: [...byId.values()],
};
writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

console.log(`\n✓ STAGE complete — ${doneStyles.length} style(s): ${doneStyles.map(s => s.id).join(', ')}`);
console.log(`  images: ${join(outDir, 'staged')}`);
console.log(`  settings.json staging block enabled (mode: demo)`);
