// StepInside local trailer renderer (Option B, MVP).
// Drives the viewer headless via Chrome, captures the canvas frame-by-frame
// (CDP screencast), then encodes a clean MP4 with ffmpeg.
//
//   npm run probe     -> one screenshot (probe.png) to verify the scene renders
//   npm run render    -> full capture + encode to OUT
//
// Tunables via env:
//   TRAILER_URL  (default: local dev server, webgl, no UI)
//   DURATION (s) FPS  WIDTH  HEIGHT  OUT
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');

const URL = process.env.TRAILER_URL ||
  'http://localhost:3000/viewer/index.html?settings=./settings.trailer.json&webgl&noui';
const DURATION = Number(process.env.DURATION || 46);   // capture window in seconds
const FPS      = Number(process.env.FPS || 60);
const WIDTH    = Number(process.env.WIDTH || 1920);
const HEIGHT   = Number(process.env.HEIGHT || 1080);
const OUT      = process.env.OUT || 'stepinside-trailer.mp4';
const FRAMES   = path.resolve('frames');

const GPU_ARGS = [
  '--no-sandbox',
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-unsafe-webgpu',
  `--window-size=${WIDTH},${HEIGHT}`,
  '--hide-scrollbars',
  '--mute-audio'
];

console.log('Launching headless Chrome (GPU)…');
const browser = await puppeteer.launch({ headless: 'new', args: GPU_ARGS });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

console.log('Loading viewer:', URL);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });

// Report the WebGL renderer so we can confirm the GPU is really being used.
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  if (!g) return 'NO-WEBGL';
  const dbg = g.getExtension('WEBGL_debug_renderer_info');
  return dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'webgl-ok';
});
console.log('WebGL renderer:', gl);

// Give the splat scene time to load + start the camera animation.
console.log('Warming up scene…');
await new Promise(r => setTimeout(r, 5000));

if (PROBE) {
  await page.screenshot({ path: 'probe.png' });
  console.log('PROBE -> probe.png');
  await browser.close();
  process.exit(0);
}

// Fresh restart so the camera animation begins near its start (assets are warm).
console.log('Reloading for a clean start…');
await page.reload({ waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 2500));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const client = await page.target().createCDPSession();
const buf = [];
client.on('Page.screencastFrame', async (f) => {
  buf.push(Buffer.from(f.data, 'base64'));            // buffer in memory (no disk stall)
  try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});

console.log(`Capturing ~${DURATION}s …`);
const tStart = Date.now();
await client.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
await new Promise(r => setTimeout(r, DURATION * 1000));
await client.send('Page.stopScreencast');
const elapsed = (Date.now() - tStart) / 1000;
await browser.close();

const capFps = buf.length / elapsed;
console.log(`Captured ${buf.length} frames over ${elapsed.toFixed(1)}s -> ${capFps.toFixed(1)} fps.`);
if (buf.length < 5) { console.error('Too few frames — scene did not render.'); process.exit(1); }

console.log('Writing frames…');
buf.forEach((b, i) => writeFileSync(path.join(FRAMES, `f-${String(i).padStart(5, '0')}.jpg`), b));

// Encode at the MEASURED fps so playback speed is correct. SMOOTH=1 adds
// motion-interpolation up to FPS for extra smoothness (slower, can warp edges).
const SMOOTH = process.env.SMOOTH === '1';
const vf = SMOOTH ? ['-vf', `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc`] : [];
console.log('Encoding MP4' + (SMOOTH ? ` (interpolated to ${FPS}fps)…` : ` at native ${capFps.toFixed(1)}fps…`));
await new Promise((res, rej) => {
  const ff = spawn(ffmpegPath, [
    '-y',
    '-framerate', capFps.toFixed(3),
    '-i', path.join(FRAMES, 'f-%05d.jpg'),
    ...vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'medium',
    '-movflags', '+faststart',
    OUT
  ], { stdio: 'inherit' });
  ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)));
});
console.log('DONE ->', path.resolve(OUT));
