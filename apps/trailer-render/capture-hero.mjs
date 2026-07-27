// Capture marketing hero frames from a scan — the REAL viewer, headless.
//
//   node apps/trailer-render/capture-hero.mjs <viewerUrl> <outBase>
//
// Writes <outBase>-walk.jpg  (the start camera — the "you are standing here"
// interior shot) and <outBase>-aerial.jpg (aerialViews[0], the drone framing).
// Reuses the exact capture path stage-scan.mjs uses (postrender canvas read),
// so what lands in the JPEG is what a visitor sees. Needs ?scout in the URL
// (exposes window.viewer) — never a visitor path. Studio server must be up.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const [viewerUrl, outBase] = process.argv.slice(2);
if (!viewerUrl || !outBase) {
  console.error('usage: node capture-hero.mjs <viewerUrl (with &scout&noui)> <outBase>');
  process.exit(1);
}

const WIDTH = 1920, HEIGHT = 1080;
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-gl=angle',
    '--use-angle=gl', `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
page.on('console', m => { const t = m.text(); if (/error|fail/i.test(t)) console.log('  [page]', t); });

console.log('Loading viewer:', viewerUrl);
await page.goto(viewerUrl, { waitUntil: 'networkidle2', timeout: 180000 });
await page.waitForFunction(() => window.viewer?.app?.graphicsDevice, { timeout: 60000 });
await new Promise(r => setTimeout(r, Number(process.env.SI_PAINT_MS) || 6000));

const grab = () => page.evaluate(() => new Promise((res, rej) => {
  const app = window.viewer.app;
  app.once('postrender', () => {
    try {
      const c = app.graphicsDevice.canvas;
      if (!c.width || !c.height) throw new Error('empty canvas');
      const off = document.createElement('canvas');
      off.width = c.width;
      off.height = c.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(c, 0, 0);
      res(off.toDataURL('image/jpeg', 0.92));
    } catch (e) { rej(String(e)); }
  });
  app.renderNextFrame = true;
}));

const save = (dataUrl, path) => {
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('  saved', path);
};

// 1. walk view (start camera, as booted)
save(await grab(), `${outBase}-walk.jpg`);

// 2. aerial view (drone framing derive-settings computed)
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
save(await grab(), `${outBase}-aerial.jpg`);

await browser.close();
console.log('done');
