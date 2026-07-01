// StepInside local trailer renderer (Option B).
// Smooth, high-res output via the "slow-shoot" technique: play the camera
// animation SLOWMO× slower, capture every painted frame, then encode back at
// the original speed → many frames per second of motion = butter-smooth, even
// in 4K (each frame is fully rendered; nothing is dropped to keep real time).
//
//   npm run probe                 -> one screenshot (probe.png) to verify render
//   npm run render                -> full trailer (defaults: 4K, 60fps out)
//   WIDTH=1920 HEIGHT=1080 npm run render   -> 1080p (faster)
//
// Env: WIDTH HEIGHT SLOWMO TARGET_FPS OUT TRAILER_BASE
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');

// Window stays at WIDTH×HEIGHT (headless WebGL fails on windows > ~1080p here),
// but DPR (deviceScaleFactor) supersamples: effective output = WIDTH*DPR × HEIGHT*DPR.
// So 1920×1080 @ DPR 2 = true 3840×2160 (4K) without a 4K window.
const WIDTH      = Number(process.env.WIDTH || 1920);
const HEIGHT     = Number(process.env.HEIGHT || 1080);
const DPR        = Number(process.env.DPR || 2);
const SLOWMO     = Number(process.env.SLOWMO || 8);     // animation slowdown factor
const TARGET_FPS = Number(process.env.TARGET_FPS || 60);
const OUT        = process.env.OUT || 'stepinside-trailer.mp4';
const FRAMES     = path.resolve('frames');

// Generate a slowed copy of the trailer settings (served by the dev server).
const VIEWER_DIR = path.resolve('..', 'website', 'public', 'viewer');
// Prefer the constant-speed smoothed path (run smooth-path.mjs) if present.
const BASE_NAME = existsSync(path.join(VIEWER_DIR, 'settings.trailer.smooth.json'))
  ? 'settings.trailer.smooth.json' : 'settings.trailer.json';
const base = JSON.parse(readFileSync(path.join(VIEWER_DIR, BASE_NAME), 'utf8'));
console.log('Path base:', BASE_NAME);
const ORIG_DURATION = base.animTracks[0].duration;
const slow = JSON.parse(JSON.stringify(base));
slow.animTracks[0].duration = ORIG_DURATION * SLOWMO;
slow.animTracks[0].keyframes.times = base.animTracks[0].keyframes.times.map(t => t * SLOWMO);
writeFileSync(path.join(VIEWER_DIR, 'settings.trailer.slow.json'), JSON.stringify(slow));

const SETTINGS = PROBE ? 'settings.trailer.json' : 'settings.trailer.slow.json';
const URL = `http://localhost:3000/viewer/index.html?settings=./${SETTINGS}&webgl&noui`;
const CAPTURE_SECONDS = ORIG_DURATION * SLOWMO + 2;

const GPU_ARGS = [
  '--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu',
  '--use-gl=angle', '--use-angle=gl', '--enable-unsafe-webgpu',
  `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--mute-audio'
];

console.log(`Render ${WIDTH}x${HEIGHT}, slowmo ${SLOWMO}x, target ${TARGET_FPS}fps, path ${ORIG_DURATION}s`);
const browser = await puppeteer.launch({ headless: 'new', args: GPU_ARGS });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR });

console.log('Loading:', URL);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 });
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  const d = g && g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : (g ? 'webgl' : 'NO-WEBGL');
});
console.log('WebGL:', gl);
await new Promise(r => setTimeout(r, 4000));   // let the scene paint at full quality

if (PROBE) { await page.screenshot({ path: 'probe.png' }); console.log('PROBE -> probe.png'); await browser.close(); process.exit(0); }

// Clean restart so the (slow) animation begins near its start.
await page.reload({ waitUntil: 'networkidle2', timeout: 120000 });
await new Promise(r => setTimeout(r, 4000));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const client = await page.target().createCDPSession();
let n = 0;
const ts = [];   // real capture timestamp per frame (to correct timing jitter)
client.on('Page.screencastFrame', (f) => {
  writeFileSync(path.join(FRAMES, `f-${String(n).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64'));
  ts.push((f.metadata && f.metadata.timestamp) ? f.metadata.timestamp : Date.now() / 1000);
  n++;
  client.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});

console.log(`Capturing ~${CAPTURE_SECONDS}s of slowed playback…`);
const t0 = Date.now();
await client.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1, maxWidth: WIDTH * DPR, maxHeight: HEIGHT * DPR });
await new Promise(r => setTimeout(r, CAPTURE_SECONDS * 1000));
await client.send('Page.stopScreencast');
const elapsed = (Date.now() - t0) / 1000;
await browser.close();

console.log(`Captured ${n} frames in ${elapsed.toFixed(0)}s.`);
if (n < 30) { console.error('Too few frames — scene did not render.'); process.exit(1); }

// Encode using each frame's REAL timestamp (mapped back to original speed by
// /SLOWMO) via the concat demuxer, then conform to constant TARGET_FPS. This
// compensates for uneven capture intervals -> smooth, correct-speed motion.
const tsBase = ts[0];
let list = '';
for (let i = 0; i < n; i++) {
  const cur = (ts[i] - tsBase) / SLOWMO;
  const next = (i < n - 1) ? (ts[i + 1] - tsBase) / SLOWMO : cur + 1 / TARGET_FPS;
  const dur = Math.max(0.0001, next - cur);
  const file = path.join(FRAMES, `f-${String(i).padStart(6, '0')}.jpg`).replace(/\\/g, '/');
  list += `file '${file}'\nduration ${dur.toFixed(5)}\n`;
}
list += `file '${path.join(FRAMES, `f-${String(n - 1).padStart(6, '0')}.jpg`).replace(/\\/g, '/')}'\n`;
const listPath = path.resolve('frames-list.txt');
writeFileSync(listPath, list);
const motionSpan = (ts[n - 1] - tsBase) / SLOWMO;
console.log(`Encoding ${n} timestamp-corrected frames over ${motionSpan.toFixed(1)}s -> ${TARGET_FPS}fps.`);
await new Promise((res, rej) => {
  const ff = spawn(ffmpegPath, [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vsync', 'cfr', '-r', String(TARGET_FPS),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
    '-movflags', '+faststart',
    OUT
  ], { stdio: 'inherit' });
  ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c)));
});
console.log('DONE ->', path.resolve(OUT), '|', `${WIDTH}x${HEIGHT} @ ${TARGET_FPS}fps, ${ORIG_DURATION}s`);
