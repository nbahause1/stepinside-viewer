/**
 * Standalone reference-image staging test (no browser, no rAF).
 *
 * Feeds the base room photo + a set of real designer-furniture reference photos
 * (Vitra / USM) to Gemini and asks it to furnish the room with those exact
 * pieces. Saves the result so we can eyeball multi-image-conditioning quality.
 *
 * Run from apps/concierge-api:
 *   node --env-file=.dev.vars test-staging.mjs <set> [portrait]
 *   <set> = klassiker | usm | colour   (default: klassiker)
 *   add "portrait" for the 9:16 mobile framing (default: landscape 16:9)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFS = join(HERE, 'staging-refs');
const OUT = join(REFS, '_out');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-image';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('Missing GEMINI_API_KEY (run with --env-file=.dev.vars)'); process.exit(1); }

// The room to (re)furnish: the current pipeline's own demo output, used as the
// base so every result is directly comparable. Landscape vs the 9:16 portrait
// framing of the same room.
const STAGED = join(HERE, '..', 'viewer', 'public', 'staged');
const ROOM_LANDSCAPE = join(STAGED, 'classic.jpg');
const ROOM_PORTRAIT = join(STAGED, 'classic-portrait.jpg');

// A short shared rule block reused by every set's prompt.
const PRESERVE = `Keep the centre of the floor open and leave every door and window clear. Use only these few pieces; do not invent extra furniture. Ignore any logos, text or watermarks printed on the reference photos.

CRITICAL - FREEZE THE ARCHITECTURE: treat the room shell as a locked background plate. Do NOT move, resize, add, remove or redraw any window, door, wall, moulding, panel, skirting or the ceiling. Every window and door must keep its EXACT position, width, height and perspective from the input photo, pixel-for-pixel. Keep the identical herringbone parquet, the exact same camera angle, vanishing lines and daylight. The ONLY change allowed is placing the furniture on the floor; everything else must be unchanged so the result lines up perfectly with the original empty room.

Photorealistic interior real-estate photograph, realistic scale and soft accurate contact shadows where furniture meets the floor. Not a 3D render, no CGI, no text, no watermark.`;

// Per-set config: folder, ordered reference files, and the placement prompt.
// The prompt assumes image 1 = room, images 2..N = the refs in this order.
const SETS = {
  klassiker: {
    out: 'staged-vitra-klassiker-v2',
    dir: 'set1-vitra-klassiker',
    refs: ['anagram-sofa.jpg', 'eames-lounge-chair.jpg', 'noguchi-coffee-table.jpg', 'vitra-akari-lamp.png'],
    prompt: `You are a professional real-estate home stager. Image 1 is a living room shot from a high angle. Images 2-5 are the EXACT designer pieces to use; in each, use ONLY the furniture item itself and ignore its background.

REMOVE all existing furniture and furnish the room with these specific pieces, reproduced faithfully (exact shape, proportions and materials):
- Image 2: a Vitra "Anagram" sofa by Panter&Tourron - low rounded arms, a slim lacquered base frame with short curved legs, soft boxy cushions, warm terracotta/rust fabric. Place it flat against the largest blank wall, facing the windows.
- Image 3: a Vitra Eames Lounge Chair with Ottoman - black leather buttoned cushions, curved walnut plywood shell, polished aluminium five-star swivel base. Angle it toward the seating.
- Image 4: a Vitra Noguchi coffee table - two identical solid walnut pieces interlocking to form the base, under a thick tear-drop glass top. Put it in front of the sofa on a simple plain low-pile rug.
- Image 5: an Akari floor lamp by Isamu Noguchi - a tall, slim, irregularly folded washi-paper shade on thin black wire tripod legs, glowing warm. Stand it in a corner near the seating.

${PRESERVE}`,
  },
  usm: {
    out: 'staged-usm-vitra',
    dir: 'set2-usm-vitra-minimal',
    refs: ['usm-haller-sideboard.jpg', 'soft-modular-sofa.jpg', 'eames-dsw-chair.jpg'],
    prompt: `You are a professional real-estate home stager. Image 1 is a living room shot from a high angle. Images 2-4 are the EXACT designer pieces to use; in each, use ONLY the furniture item itself and ignore its background.

Furnish the room in a clean, minimalist Swiss-design style. REMOVE all existing furniture and add these specific pieces, reproduced faithfully (exact shape, proportions and materials):
- Image 2: a USM Haller modular sideboard in pure white (RAL 9010) - a chrome tubular frame with flat white metal panels, two drop-down doors with the signature round chrome ball handles and chrome ball joints at every corner, low on small chrome feet. Place it flat against a free wall.
- Image 3: a Vitra "Soft Modular" sofa by Jasper Morrison - a low, ground-hugging sofa with thick boxy cushions, soft square arms and a recessed dark plinth base, in a cream/ivory fabric. Place it against the largest blank wall, facing the windows.
- Image 4: two Vitra Eames Plastic Side Chairs (DSW) - a light grey moulded seat shell on slim yellowish-maple dowel legs with a black wire strut. Place them as a small pair near the seating.
Add a simple low rectangular coffee table in light oak in front of the sofa on a plain pale rug, and a green plant in a corner.

${PRESERVE}`,
  },
  colour: {
    out: 'staged-colour-pop',
    dir: 'set3-colour-pop',
    refs: ['usm-haller-sideboard.jpg', 'panton-chair.jpg', 'eames-dsw-chair.jpg', 'soft-modular-sofa.jpg'],
    prompt: `You are a professional real-estate home stager. Image 1 is a living room shot from a high angle. Images 2-5 are the EXACT designer pieces to use; in each, use ONLY the furniture item itself and ignore its background.

Furnish the room in a confident, characterful colour-pop style with one or two bold accents against the calm room. REMOVE all existing furniture and add these specific pieces, reproduced faithfully (exact shape, proportions and materials):
- Image 2: a USM Haller modular sideboard - chrome tubular frame, flat metal panels with the signature round chrome ball handles and ball joints - but rendered in a bold GOLDEN YELLOW. Place it flat against a free wall as the statement piece.
- Image 3: a Vitra Panton Chair - a single flowing S-shaped cantilever chair moulded in one piece, glossy, in classic RED. Place it as an accent near the window.
- Image 4: a couple of Vitra Eames Plastic Side Chairs (DSW) with maple dowel legs, seat shells in soft muted colours. Place them near the seating.
- Image 5: a Vitra "Soft Modular" sofa by Jasper Morrison - low, boxy, soft square arms, recessed dark plinth base - in a warm neutral oatmeal fabric so the colour accents stand out. Place it against the largest blank wall, facing the windows.
Add a simple low coffee table and a plain rug.

${PRESERVE}`,
  },
};

const mimeOf = (p) => p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
async function part(path) {
  const buf = await readFile(path);
  return { inline_data: { mime_type: mimeOf(path), data: buf.toString('base64') } };
}

async function main() {
  const key = process.argv[2] || 'klassiker';
  const portrait = process.argv[3] === 'portrait';
  const cfg = SETS[key];
  if (!cfg) { console.error(`Unknown set "${key}". Use: ${Object.keys(SETS).join(' | ')}`); process.exit(1); }

  const ROOM = portrait ? ROOM_PORTRAIT : ROOM_LANDSCAPE;
  const aspectRatio = portrait ? '9:16' : '16:9';

  await mkdir(OUT, { recursive: true });
  console.log(`Set "${key}" (${portrait ? 'portrait 9:16' : 'landscape 16:9'}): reading room + ${cfg.refs.length} references...`);
  const roomPart = await part(ROOM);
  const refParts = await Promise.all(cfg.refs.map((f) => part(join(REFS, cfg.dir, f))));
  console.log(`  room: ${basename(ROOM)}  +  ${cfg.refs.join(', ')}`);

  const body = {
    contents: [{ parts: [{ text: cfg.prompt }, roomPart, ...refParts] }],
    generationConfig: { imageConfig: { imageSize: '2K', aspectRatio } },
  };

  console.log(`Calling ${MODEL} (1 room + ${refParts.length} refs)...`);
  const t0 = Date.now();
  const res = await fetch(`${GEMINI_BASE}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log(`  HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!res.ok) { console.error((await res.text()).slice(0, 800)); process.exit(1); }

  const data = await res.json();
  if (data.promptFeedback?.blockReason) { console.error('Blocked:', data.promptFeedback.blockReason); process.exit(1); }

  let saved = null;
  for (const c of data.candidates ?? []) {
    for (const p of c.content?.parts ?? []) {
      const inline = p.inlineData ?? p.inline_data;
      const b64 = inline?.data;
      if (b64) {
        const mime = inline.mimeType ?? inline.mime_type ?? 'image/png';
        const ext = mime.includes('png') ? 'png' : 'jpg';
        saved = join(OUT, `${cfg.out}${portrait ? '-portrait' : ''}.${ext}`);
        await writeFile(saved, Buffer.from(b64, 'base64'));
        break;
      }
    }
    if (saved) break;
  }
  if (!saved) { console.error('No image in response.'); console.error(JSON.stringify(data).slice(0, 600)); process.exit(1); }
  console.log(`Saved -> ${saved}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
