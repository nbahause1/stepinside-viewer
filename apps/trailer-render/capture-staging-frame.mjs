// Reproduce the LIVE staging frame-capture headlessly.
//
// The viewer's staging pipeline (apps/viewer/src/staging.ts) flies to a fixed
// aerial "drone" view (aerialViews[0]) and grabs the canvas as a downscaled
// JPEG. This script does the SAME thing offline: it boots the real viewer in
// headless Chromium, fires the exact same `inputEvent 'aerialGoto' 0`, waits for
// `aerialArrived`, then reads the canvas at `postrender` (the WebGL-safe path
// used by captureFrame) — giving the identical frame the live /stage call sends.
//
// Prereq: dev server running -> cd apps/website && npx next dev -p 3000
// Run:    cd apps/trailer-render && node capture-staging-frame.mjs [out.jpg]
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '../concierge-api/staging-frame.jpg');
const MAX_CAPTURE_EDGE = 1536;                       // matches staging.ts
const WIDTH = 1920, HEIGHT = 1080, DPR = 1;
const URL = 'http://localhost:3000/viewer/index.html?webgl&noui';

const GPU_ARGS = [
  '--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu',
  '--use-gl=angle', '--use-angle=gl',
  `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--mute-audio',
];

const browser = await puppeteer.launch({ headless: 'new', args: GPU_ARGS });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR });
page.on('console', m => { const t = m.text(); if (/error|fail|warn/i.test(t)) console.log('  [page]', t); });

console.log('Loading viewer:', URL);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });

// Wait until the viewer global + scene are ready.
await page.waitForFunction(() => window.viewer && window.viewer.app && window.viewer.app.graphicsDevice, { timeout: 60000 });
await new Promise(r => setTimeout(r, 4000));         // let the splat paint at full quality

// 1) Fly to the fixed staging aerial view (index 0) — same call staging.ts makes.
console.log('Flying to staging aerial view (index 0)…');
await page.evaluate(() => new Promise((resolve) => {
  const g = window.viewer;
  let done = false;
  const finish = () => { if (done) return; done = true; g.events.off('aerialArrived', on); resolve(); };
  const on = () => finish();
  g.events.on('aerialArrived', on);
  setTimeout(finish, 3500);                          // safety (matches goToStagingAerial's timeout)
  g.events.fire('inputEvent', 'aerialGoto', 0);
}));
await new Promise(r => setTimeout(r, 1200));         // settle

// 2) Grab the canvas at postrender, downscaled to 1536 max edge — grabCanvas().
console.log('Capturing frame…');
const dataUrl = await page.evaluate((MAX) => new Promise((resolve, reject) => {
  const app = window.viewer.app;
  app.once('postrender', () => {
    try {
      const canvas = app.graphicsDevice.canvas;
      const srcW = canvas.width, srcH = canvas.height;
      if (!srcW || !srcH) throw new Error('empty canvas');
      const scale = Math.min(1, MAX / Math.max(srcW, srcH));
      const w = Math.max(1, Math.round(srcW * scale));
      const h = Math.max(1, Math.round(srcH * scale));
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx = off.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(canvas, 0, 0, w, h);
      resolve(off.toDataURL('image/jpeg', 0.9));
    } catch (e) { reject(String(e)); }
  });
  app.renderNextFrame = true;
}), MAX_CAPTURE_EDGE);

await browser.close();

const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log('Saved staging frame ->', OUT);
