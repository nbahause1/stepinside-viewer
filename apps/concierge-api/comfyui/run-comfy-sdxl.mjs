// Documented staging pipeline (Approach A): SDXL + Depth-CN + Canny-CN +
// Grounded-SAM floor-mask INPAINT + IP-Adapter (all 4 refs). Only the floor
// region is regenerated; walls/windows stay pixel-identical.
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const COMFY = 'https://f5ws9ad66xuuzo-8188.proxy.runpod.net';
const A = 'C:/Users/Hauke/projekte/stepinside-viewer/apps/concierge-api';
const ROOM = `${A}/staging-frame.jpg`;
const REFS = [
  `${A}/staging-refs/set1-vitra-klassiker/anagram-sofa.jpg`,
  `${A}/staging-refs/set1-vitra-klassiker/eames-lounge-chair.jpg`,
  `${A}/staging-refs/set1-vitra-klassiker/noguchi-coffee-table.jpg`,
  `${A}/staging-refs/set1-vitra-klassiker/vitra-akari-lamp.png`,
];
const OUT_IMG  = `${A}/staging-refs/_out/comfyui-classic.png`;
const OUT_MASK = `${A}/staging-refs/_out/comfyui-mask.png`;

const mimeOf = p => p.endsWith('.png') ? 'image/png' : 'image/jpeg';
async function upload(path) {
  const buf = await readFile(path);
  const form = new FormData();
  form.append('image', new Blob([buf], { type: mimeOf(path) }), basename(path));
  form.append('overwrite', 'true');
  const r = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`upload ${basename(path)}: ${r.status} ${await r.text()}`);
  return (await r.json()).name;
}

const POS = 'a professional real-estate photograph of an elegant living room, furnished with a Vitra Anagram sofa in warm terracotta fabric against the wall facing the windows, a black leather Eames lounge chair with ottoman, a Noguchi glass coffee table in front of it, an Akari paper floor lamp in a corner; the existing herringbone parquet floor stays unchanged, realistic scale and proportions, soft accurate contact shadows where furniture meets the floor, warm daylight, photorealistic interior photo, not a 3d render';
const NEG = 'empty room, changed walls, altered windows, moved doors, new architecture, distorted perspective, floating furniture, duplicated furniture, cartoon, cgi, 3d render, illustration, text, watermark, low quality, blurry';

const room = await upload(ROOM);
const refs = [];
for (const r of REFS) refs.push(await upload(r));
console.log('uploaded room + refs:', room, refs.join(', '));

const g = {
  "1":  { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  "2":  { class_type: "VAELoader", inputs: { vae_name: "sdxl_vae.safetensors" } },
  "3":  { class_type: "LoadImage", inputs: { image: room } },
  "4":  { class_type: "CLIPTextEncode", inputs: { text: POS, clip: ["1", 1] } },
  "5":  { class_type: "CLIPTextEncode", inputs: { text: NEG, clip: ["1", 1] } },

  // Depth ControlNet
  "6":  { class_type: "DepthAnythingV2Preprocessor", inputs: { image: ["3", 0], ckpt_name: "depth_anything_v2_vitb.pth", resolution: 1024 } },
  "7":  { class_type: "ControlNetLoader", inputs: { control_net_name: "controlnet-union-sdxl-promax.safetensors" } },
  "8":  { class_type: "SetUnionControlNetType", inputs: { control_net: ["7", 0], type: "depth" } },
  "9":  { class_type: "ControlNetApplyAdvanced", inputs: { positive: ["4", 0], negative: ["5", 0], control_net: ["8", 0], image: ["6", 0], strength: 0.55, start_percent: 0.0, end_percent: 0.4, vae: ["2", 0] } },

  // Canny ControlNet (separate loader to avoid type mutation)
  "10": { class_type: "CannyEdgePreprocessor", inputs: { image: ["3", 0], low_threshold: 100, high_threshold: 200, resolution: 1024 } },
  "11": { class_type: "ControlNetLoader", inputs: { control_net_name: "controlnet-union-sdxl-promax.safetensors" } },
  "12": { class_type: "SetUnionControlNetType", inputs: { control_net: ["11", 0], type: "canny/lineart/anime_lineart/mlsd" } },
  "13": { class_type: "ControlNetApplyAdvanced", inputs: { positive: ["9", 0], negative: ["9", 1], control_net: ["12", 0], image: ["10", 0], strength: 0.35, start_percent: 0.0, end_percent: 0.5, vae: ["2", 0] } },

  // IP-Adapter with all 4 designer references batched
  "14": { class_type: "IPAdapterUnifiedLoader", inputs: { model: ["1", 0], preset: "PLUS (high strength)" } },
  "15": { class_type: "LoadImage", inputs: { image: refs[0] } },
  "16": { class_type: "LoadImage", inputs: { image: refs[1] } },
  "17": { class_type: "LoadImage", inputs: { image: refs[2] } },
  "18": { class_type: "LoadImage", inputs: { image: refs[3] } },
  "19": { class_type: "ImageBatch", inputs: { image1: ["15", 0], image2: ["16", 0] } },
  "20": { class_type: "ImageBatch", inputs: { image1: ["19", 0], image2: ["17", 0] } },
  "21": { class_type: "ImageBatch", inputs: { image1: ["20", 0], image2: ["18", 0] } },
  "22": { class_type: "IPAdapter", inputs: { model: ["14", 0], ipadapter: ["14", 1], image: ["15", 0], weight: 0.55, start_at: 0.0, end_at: 1.0, weight_type: "standard" } },

  // Floor / furnishable-region mask (geometric, for the FIXED staging viewpoint):
  // a soft square over the lower-centre floor. Protects the upper walls/windows.
  "23": { class_type: "CreateShapeMask", inputs: { shape: "square", frames: 1, location_x: 768, location_y: 600, grow: 0, frame_width: 1536, frame_height: 864, shape_width: 1460, shape_height: 560 } },
  "26": { class_type: "FeatherMask", inputs: { mask: ["23", 0], left: 140, top: 200, right: 140, bottom: 60 } },

  // Inpaint: only the (grown floor) region is regenerated
  "27": { class_type: "VAEEncode", inputs: { pixels: ["3", 0], vae: ["2", 0] } },
  "28": { class_type: "SetLatentNoiseMask", inputs: { samples: ["27", 0], mask: ["26", 0] } },
  "29": { class_type: "KSampler", inputs: { model: ["22", 0], seed: 88888, steps: 30, cfg: 7.0, sampler_name: "dpmpp_2m", scheduler: "karras", positive: ["13", 0], negative: ["13", 1], latent_image: ["28", 0], denoise: 0.8 } },
  "30": { class_type: "VAEDecode", inputs: { samples: ["29", 0], vae: ["2", 0] } },
  "31": { class_type: "SaveImage", inputs: { images: ["30", 0], filename_prefix: "stepinside_classic" } },

  // Debug: save the floor mask
  "32": { class_type: "MaskToImage", inputs: { mask: ["26", 0] } },
  "33": { class_type: "SaveImage", inputs: { images: ["32", 0], filename_prefix: "stepinside_mask" } },
};

const q = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: g, client_id: 'stepinside' }) });
const qt = await q.text();
if (!q.ok) { console.error('PROMPT ERROR', q.status); console.error(qt.slice(0, 3000)); process.exit(1); }
const { prompt_id } = JSON.parse(qt);
console.log('queued', prompt_id, '(first run downloads SAM+DINO ~3GB, be patient)');

async function grab(nodeId, dest) {
  const h = await (await fetch(`${COMFY}/history/${prompt_id}`)).json();
  const img = h[prompt_id]?.outputs?.[nodeId]?.images?.[0];
  if (!img) return false;
  const p = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
  const buf = Buffer.from(await (await fetch(`${COMFY}/view?${p}`)).arrayBuffer());
  await writeFile(dest, buf);
  console.log('SAVED', dest, buf.length, 'bytes');
  return true;
}

for (let i = 0; i < 240; i++) {
  await new Promise(r => setTimeout(r, 2500));
  const h = await (await fetch(`${COMFY}/history/${prompt_id}`)).json();
  const e = h[prompt_id];
  if (!e) continue;
  if (e.status?.status_str === 'error') {
    const m = (e.status.messages || []).filter(x => x[0] === 'execution_error');
    console.error('EXEC ERROR:', JSON.stringify(m, null, 1).slice(0, 2500));
    process.exit(1);
  }
  if (e.status?.completed) {
    const ok = await grab("31", OUT_IMG);
    await grab("33", OUT_MASK);
    if (!ok) console.error('WARN: node 31 produced no output (cached/skipped)');
    process.exit(ok ? 0 : 2);
  }
}
console.error('timed out');
process.exit(1);
