/**
 * Drive the self-hosted ComfyUI staging pipeline over its HTTP API — the offline
 * equivalent of test-staging.mjs, but pointing at our ComfyUI server instead of
 * Gemini. Mirrors the same idea: feed the captured room + the style's reference
 * furniture, save the result, eyeball arrangement + architecture lock.
 *
 * Prereq: ComfyUI running (see comfyui/install.sh) AND the graph built + exported
 * as API format to comfyui/staging-workflow.api.json (see comfyui/workflow-design.md).
 *
 * Run from apps/concierge-api (tunnel the pod's 8188 to localhost first):
 *   COMFY_URL=http://localhost:8188 node test-comfyui.mjs <room.jpg> [classic|scandi|warm]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFS = join(HERE, 'staging-refs');
const OUT = join(REFS, '_out');
const WORKFLOW = join(HERE, 'comfyui', 'staging-workflow.api.json');
const COMFY = (process.env.COMFY_URL || 'http://localhost:8188').replace(/\/$/, '');

// ── Node-id map: fill these in from staging-workflow.api.json AFTER you build and
// "Save (API Format)" the graph. Each value is the string node id in that JSON.
const NODES = {
  room:      'TODO_LOADIMAGE_ROOM_ID',     // LoadImage for the empty-room frame
  positive:  'TODO_CLIPTEXTENCODE_POS_ID',  // positive prompt (style placement)
  refImages: [],                            // e.g. ['12','13','14'] LoadImage ids for the refs (in refs order)
  output:    'TODO_SAVEIMAGE_ID',           // SaveImage node we read the result from
};

// Style → reference folder + files (order matters) + a short placement prompt.
// The real server owns the full prompt (staging-prompt.ts); this mirrors it for
// standalone testing only.
const STYLES = {
  classic: { dir: 'set1-vitra-klassiker', refs: ['anagram-sofa.jpg', 'eames-lounge-chair.jpg', 'noguchi-coffee-table.jpg', 'vitra-akari-lamp.png'],
    prompt: 'Furnish this empty room with a terracotta Vitra Anagram fabric sofa against the largest wall, a black-leather Eames Lounge Chair with ottoman, a Noguchi glass coffee table on a plain rug, and an Akari washi floor lamp in a corner. Photorealistic real-estate photo, keep walls/windows/doors identical.' },
  scandi:  { dir: 'set2-usm-vitra-minimal', refs: ['usm-haller-sideboard.jpg', 'soft-modular-sofa.jpg', 'eames-dsw-chair.jpg'],
    prompt: 'Furnish this empty room minimalist: white USM Haller sideboard, cream Vitra Soft Modular sofa, a pair of Eames DSW chairs, light-oak coffee table on a pale rug. Photorealistic, keep architecture identical.' },
  warm:    { dir: 'set3-colour-pop', refs: ['usm-haller-sideboard.jpg', 'panton-chair.jpg', 'eames-dsw-chair.jpg', 'soft-modular-sofa.jpg'],
    prompt: 'Furnish this empty room colour-pop: golden-yellow USM Haller sideboard, red Panton chair by the window, Eames DSW chairs, oatmeal Soft Modular sofa. Photorealistic, keep architecture identical.' },
};

const mimeOf = (p) => p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

// Upload a local image to ComfyUI's input store; returns the stored filename.
async function uploadImage(path) {
  const buf = await readFile(path);
  const form = new FormData();
  form.append('image', new Blob([buf], { type: mimeOf(path) }), basename(path));
  form.append('overwrite', 'true');
  const res = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload ${basename(path)} failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.name; // ComfyUI may suffix on collision; use what it returns
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const roomPath = process.argv[2];
  const styleId = process.argv[3] || 'classic';
  if (!roomPath) { console.error('Usage: COMFY_URL=... node test-comfyui.mjs <room.jpg> [classic|scandi|warm]'); process.exit(1); }
  const style = STYLES[styleId];
  if (!style) { console.error(`Unknown style "${styleId}". Use: ${Object.keys(STYLES).join(' | ')}`); process.exit(1); }
  if (!existsSync(WORKFLOW)) {
    console.error(`Missing ${WORKFLOW}\nBuild the graph in ComfyUI (comfyui/workflow-design.md), "Save (API Format)" to that path, then fill the NODES map in this file.`);
    process.exit(1);
  }
  if (NODES.room.startsWith('TODO')) {
    console.error('Fill the NODES map (node ids) at the top of this file from staging-workflow.api.json first.');
    process.exit(1);
  }

  const workflow = JSON.parse(await readFile(WORKFLOW, 'utf8'));

  // 1. Upload the room + the style's reference furniture, wire them into the graph.
  console.log(`Uploading room + ${style.refs.length} references…`);
  const roomName = await uploadImage(roomPath);
  workflow[NODES.room].inputs.image = roomName;
  workflow[NODES.positive].inputs.text = style.prompt;
  for (let i = 0; i < style.refs.length && i < NODES.refImages.length; i++) {
    const name = await uploadImage(join(REFS, style.dir, style.refs[i]));
    workflow[NODES.refImages[i]].inputs.image = name;
  }

  // 2. Queue the prompt.
  console.log('Queueing prompt…');
  const clientId = `stepinside-${styleId}`;
  const q = await fetch(`${COMFY}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!q.ok) { console.error('queue failed:', q.status, (await q.text()).slice(0, 800)); process.exit(1); }
  const { prompt_id } = await q.json();

  // 3. Poll history until this prompt has an output.
  const t0 = Date.now();
  let outImg = null;
  for (let i = 0; i < 300; i++) {           // up to ~5 min
    await sleep(1000);
    const h = await fetch(`${COMFY}/history/${prompt_id}`);
    if (!h.ok) continue;
    const hist = await h.json();
    const entry = hist[prompt_id];
    if (!entry) continue;
    const node = entry.outputs?.[NODES.output];
    if (node?.images?.length) { outImg = node.images[0]; break; }
    if (entry.status?.completed && !node) { console.error('Prompt completed but no image on the output node.'); process.exit(1); }
  }
  if (!outImg) { console.error('Timed out waiting for the image.'); process.exit(1); }
  console.log(`Generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 4. Download the result.
  const params = new URLSearchParams({ filename: outImg.filename, subfolder: outImg.subfolder || '', type: outImg.type || 'output' });
  const img = await fetch(`${COMFY}/view?${params}`);
  const buf = Buffer.from(await img.arrayBuffer());
  await mkdir(OUT, { recursive: true });
  const out = join(OUT, `comfyui-${styleId}.png`);
  await writeFile(out, buf);
  console.log(`Saved -> ${out}`);
  console.log(`Compare against Gemini: apps/website/public/viewer/staged/${styleId}.jpg`);
}

main().catch((e) => { console.error(e); process.exit(1); });
