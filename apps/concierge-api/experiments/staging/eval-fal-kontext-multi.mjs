/**
 * FLUX.1 Kontext [max] MULTI-IMAGE eval via fal.ai — the real test the single-
 * image probefahrt couldn't do: feed the empty room + our EXACT Vitra/USM
 * reference furniture together and see if Kontext places our specific pieces
 * while holding the architecture. Mirrors the Gemini/Nano-Banana input shape.
 *
 * Run from apps/concierge-api (FAL_KEY in .dev.vars):
 *   node --env-file=.dev.vars eval-fal-kontext-multi.mjs
 * Output: staging-refs/_out/eval-kontext-multi-classic.png   (US-hosted, eval only)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'staging-refs', '_out');
const ENDPOINT = 'https://fal.run/fal-ai/flux-pro/kontext/max/multi';
const falKey = process.env.FAL_KEY;
if (!falKey) { console.error('Missing FAL_KEY (run with --env-file=.dev.vars)'); process.exit(1); }

const ROOM = join(HERE, 'staging-frame.jpg');
const REFS = [
  join(HERE, 'staging-refs', 'set1-vitra-klassiker', 'anagram-sofa.jpg'),
  join(HERE, 'staging-refs', 'set1-vitra-klassiker', 'eames-lounge-chair.jpg'),
  join(HERE, 'staging-refs', 'set1-vitra-klassiker', 'noguchi-coffee-table.jpg'),
];

const PROMPT = `You are a professional real-estate home stager. Image 1 is an empty living room shot from a high angle. Images 2-5 are the EXACT designer pieces to place; in each use ONLY the furniture item and ignore its background. Reproduce each faithfully (exact shape, proportions, materials):
- Image 2: a Vitra "Anagram" sofa, warm terracotta/rust fabric, low rounded arms, slim lacquered base. Place it flat against the largest blank wall, facing the windows.
- Image 3: a Vitra Eames Lounge Chair with Ottoman, black leather, walnut shell. Angle it toward the seating.
- Image 4: a Vitra Noguchi glass coffee table with interlocking walnut base. Put it in front of the sofa on a plain low rug.
Add a slim Akari washi-paper floor lamp glowing warm in a corner near the seating.
CRITICAL - FREEZE THE ARCHITECTURE: keep every window, door, wall, moulding, the herringbone parquet floor, the exact camera angle, perspective and daylight from image 1 pixel-for-pixel. The only change is adding the furniture. Photorealistic interior real-estate photograph, realistic scale, soft accurate contact shadows. Not a 3D render, no CGI, no text, no watermark.`;

const mimeOf = p => p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
const dataUri = async p => `data:${mimeOf(p)};base64,${(await readFile(p)).toString('base64')}`;

const image_urls = [];
for (const p of [ROOM, ...REFS]) image_urls.push(await dataUri(p));
console.log(`Calling FLUX Kontext [max] multi with room + ${REFS.length} refs...`);

const t0 = Date.now();
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: PROMPT, image_urls, guidance_scale: 3.5, aspect_ratio: '16:9', seed: 42 }),
});
console.log(`  HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!res.ok) { console.error((await res.text()).slice(0, 1000)); process.exit(1); }

const data = await res.json();
const url = data?.images?.[0]?.url;
if (!url) { console.error('No image URL:', JSON.stringify(data).slice(0, 600)); process.exit(1); }
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
await mkdir(OUT, { recursive: true });
const out = join(OUT, 'eval-kontext-multi-classic.png');
await writeFile(out, buf);
console.log('SAVED ->', out, buf.length, 'bytes');
