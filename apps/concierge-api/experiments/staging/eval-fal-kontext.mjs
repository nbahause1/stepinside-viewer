/**
 * PROBEFAHRT: FLUX.1 Kontext [dev] quality eval via fal.ai (throwaway, NOT prod).
 *
 * Purpose: eyeball whether FLUX Kontext gets close to Nano Banana on OUR real
 * room — specifically (1) photorealism ("does it look like AI?") and (2)
 * architecture lock (walls/windows/doors stay put). It does NOT test exact
 * designer-furniture fidelity: FLUX Kontext [dev] takes only ONE input image,
 * so we condition furniture via TEXT only here (reference-image fidelity is a
 * separate step, either FLUX multi-image or the SDXL + IP-Adapter path).
 *
 * Run from apps/concierge-api (put FAL_KEY in .dev.vars, already gitignored):
 *   node --env-file=.dev.vars eval-fal-kontext.mjs <path-to-empty-room.jpg> [style]
 *   [style] = classic | scandi | warm     (default: classic)
 *
 * Costs a few cents per call (fal.ai, US-hosted — eval only, no customer data).
 * Output is saved next to the Gemini test outputs: staging-refs/_out/.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'staging-refs', '_out');

const FAL_ENDPOINT = 'https://fal.run/fal-ai/flux-kontext/dev';
const falKey = process.env.FAL_KEY;
if (!falKey) {
  console.error('Missing FAL_KEY. Add `FAL_KEY=...` to apps/concierge-api/.dev.vars and run with --env-file=.dev.vars');
  process.exit(1);
}

// Same architecture-lock rules as the live Gemini pipeline, so the comparison
// is apples-to-apples on the thing that matters for the scan<->furnished toggle.
const PRESERVE = `Keep the centre of the floor open and leave every door and window clear. Use only a few designer pieces; do not invent extra furniture.

CRITICAL - FREEZE THE ARCHITECTURE: treat the room shell as a locked background plate. Do NOT move, resize, add, remove or redraw any window, door, wall, moulding, panel, skirting or the ceiling. Every window and door must keep its EXACT position, width, height and perspective from the input photo, pixel-for-pixel. Keep the identical floor, the exact same camera angle, vanishing lines and daylight. The ONLY change allowed is placing furniture on the floor, so the result lines up perfectly with the original empty room.

Photorealistic interior real-estate photograph, realistic scale and soft accurate contact shadows where furniture meets the floor. Not a 3D render, no CGI, no text, no watermark.`;

// Text-only furniture description per style (no reference images in this eval).
const STYLES = {
  classic: `Furnish this empty living room with these exact designer pieces, reproduced faithfully:
- a Vitra "Anagram" sofa: low rounded arms, slim lacquered base frame with short curved legs, soft boxy cushions, warm terracotta/rust fabric. Against the largest blank wall, facing the windows.
- a Vitra Eames Lounge Chair with Ottoman: black leather buttoned cushions, curved walnut plywood shell, polished aluminium five-star swivel base. Angled toward the seating.
- a Vitra Noguchi coffee table: interlocking solid walnut base under a thick tear-drop glass top. In front of the sofa on a simple plain low-pile rug.
- an Akari floor lamp by Isamu Noguchi: tall slim irregularly folded washi-paper shade on thin black wire tripod legs, glowing warm. In a corner near the seating.`,
  scandi: `Furnish this empty living room in a clean minimalist Swiss-design style:
- a USM Haller modular sideboard in pure white (RAL 9010): chrome tubular frame, flat white metal panels, signature round chrome ball handles and ball joints, low on small chrome feet. Flat against a free wall.
- a Vitra "Soft Modular" sofa by Jasper Morrison: low ground-hugging, thick boxy cushions, soft square arms, recessed dark plinth base, cream/ivory fabric. Against the largest blank wall, facing the windows.
- two Vitra Eames DSW side chairs: light grey moulded shell on slim maple dowel legs. A small pair near the seating.
Add a low light-oak coffee table on a plain pale rug and a green plant in a corner.`,
  warm: `Furnish this empty living room in a confident colour-pop style, calm room with one or two bold accents:
- a USM Haller modular sideboard in bold GOLDEN YELLOW: chrome frame, flat panels, signature round chrome ball handles. Flat against a free wall as the statement piece.
- a Vitra Panton Chair: single flowing S-shaped cantilever, glossy, classic RED. As an accent near the window.
- a couple of Vitra Eames DSW side chairs with maple dowel legs, seat shells in soft muted colours. Near the seating.
- a Vitra "Soft Modular" sofa in warm oatmeal fabric so the accents stand out. Against the largest blank wall, facing the windows.
Add a simple low coffee table and a plain rug.`,
};

const mimeOf = (p) => p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

async function main() {
  const roomPath = process.argv[2];
  const style = process.argv[3] || 'classic';
  if (!roomPath) { console.error('Usage: node --env-file=.dev.vars eval-fal-kontext.mjs <empty-room.jpg> [classic|scandi|warm]'); process.exit(1); }
  if (!STYLES[style]) { console.error(`Unknown style "${style}". Use: ${Object.keys(STYLES).join(' | ')}`); process.exit(1); }

  const prompt = `You are a professional real-estate home stager. This is an empty room. If it contains any furniture, remove it first.\n\n${STYLES[style]}\n\n${PRESERVE}`;

  const buf = await readFile(roomPath);
  const imageDataUri = `data:${mimeOf(roomPath)};base64,${buf.toString('base64')}`;

  await mkdir(OUT, { recursive: true });
  console.log(`Room: ${basename(roomPath)}  |  style: ${style}  |  calling FLUX Kontext [dev] on fal.ai...`);
  const t0 = Date.now();
  const res = await fetch(FAL_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_url: imageDataUri,
      num_inference_steps: 30,
      guidance_scale: 2.5,
      output_format: 'png',
      seed: 42, // fixed so re-runs are comparable
    }),
  });
  console.log(`  HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!res.ok) { console.error((await res.text()).slice(0, 800)); process.exit(1); }

  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) { console.error('No image URL in response:', JSON.stringify(data).slice(0, 600)); process.exit(1); }

  const img = await fetch(url);
  const outBuf = Buffer.from(await img.arrayBuffer());
  const out = join(OUT, `eval-kontext-${style}.png`);
  await writeFile(out, outBuf);
  console.log(`Saved -> ${out}`);
  console.log(`Compare against Gemini: apps/website/public/viewer/staged/${style}.jpg`);
}

main().catch((e) => { console.error(e); process.exit(1); });
