// VLM layout planner: Gemini looks at the room (frame + our detected openings)
// and produces a room-aware furniture layout PLAN (JSON), which then drives FLUX
// Kontext. Replaces the hand-rolled heuristic with real spatial reasoning.
//   node --env-file=.dev.vars vlm-layout.mjs
import { readFile, writeFile } from 'node:fs/promises';

const gKey = process.env.GEMINI_API_KEY;
const fKey = process.env.FAL_KEY;
if (!gKey && !fKey) { console.error('Need GEMINI_API_KEY or FAL_KEY in .dev.vars'); process.exit(1); }
const G_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const frame = 'staging-frame.jpg';
const openings = JSON.parse(await readFile('staging-refs/_out/layout-plan.json', 'utf8')).keepClear ?? [];

// ---- 1. Gemini plans the layout (vision + reasoning -> JSON) -------------------
const planPrompt = `You are an expert real-estate home stager and interior designer.
Image 1 is an EMPTY living room shot from a high angle. From our separate detector, these openings were found: ${JSON.stringify(openings)} (wall = left/right/back relative to this image; keep them clear).
Plan a tasteful, realistic furniture layout using: a 3-seat sofa, a lounge chair with ottoman, a coffee table, and a floor lamp.
Use the room's ACTUAL geometry (wall lengths, windows, doors, circulation). Rules: never block windows or doors; sofa flat against the longest solid wall; keep a natural walking path; realistic scale.
Return ONLY JSON: {"pieces":[{"item":"sofa|lounge_chair|coffee_table|floor_lamp","wall":"left|right|back|center","placement":"short phrase","orientation":"faces ..."}],"keep_clear":["short phrases"],"reasoning":"1-2 sentences"}`;

const imgB64 = (await readFile(frame)).toString('base64');
let planText;
if (gKey) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${G_MODEL}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': gKey, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: planPrompt }, { inline_data: { mime_type: 'image/jpeg', data: imgB64 } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
  });
  if (!r.ok) { console.error('Gemini', r.status, (await r.text()).slice(0, 500)); process.exit(1); }
  planText = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text;
} else {
  // fal VLM router (uses FAL_KEY; model routes to Gemini/Claude/Qwen)
  const r = await fetch('https://fal.run/fal-ai/any-llm/vision', {
    method: 'POST', headers: { Authorization: `Key ${fKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: planPrompt + '\nReturn ONLY valid minified JSON, no markdown fences.', image_urls: [`data:image/jpeg;base64,${imgB64}`], model: process.env.VLM_MODEL || 'google/gemini-2.5-flash' }),
  });
  if (!r.ok) { console.error('fal-vlm', r.status, (await r.text()).slice(0, 500)); process.exit(1); }
  planText = (await r.json()).output || '';
}
planText = (planText || '').replace(/```json|```/g, '').trim();
let plan; try { plan = JSON.parse(planText); } catch { console.error('bad JSON from VLM:', planText.slice(0, 400)); process.exit(1); }
await writeFile('staging-refs/_out/layout-plan-vlm.json', JSON.stringify(plan, null, 2));
console.log('=== VLM LAYOUT PLAN ===');
console.log(JSON.stringify(plan, null, 1));

// ---- 2. Build a FLUX prompt from the VLM plan and generate ---------------------
if (!fKey) { console.log('(no FAL_KEY -> plan only, skipping image)'); process.exit(0); }
const REFS = ['anagram-sofa.jpg','eames-lounge-chair.jpg','noguchi-coffee-table.jpg'].map(f => `staging-refs/set1-vitra-klassiker/${f}`);
const sidePhrase = { left:'the left-hand wall', right:'the right-hand wall', back:'the far back wall', center:'the centre of the room' };
const placementLines = plan.pieces.map(p => `- ${p.item.replace('_',' ')}: ${sidePhrase[p.wall]||p.wall}, ${p.placement}, ${p.orientation||''}`).join('\n');
const PROMPT = `You are a professional real-estate home stager. Image 1 is an empty living room; images 2-4 are the exact designer pieces (use only the furniture). Furnish it EXACTLY per this plan:\n${placementLines}\nKeep clear: ${plan.keep_clear.join('; ')}. Never place furniture in front of windows or doors. Keep every window, door, wall and the herringbone parquet exactly as in image 1, same camera angle. Photorealistic real-estate photo, soft contact shadows, not a render.`;

const mimeOf = p => p.endsWith('.png') ? 'image/png' : 'image/jpeg';
const uri = async p => `data:${mimeOf(p)};base64,${(await readFile(p)).toString('base64')}`;
const image_urls = [await uri(frame)]; for (const r of REFS) image_urls.push(await uri(r));
console.log('\ngenerating VLM-guided staging…');
const fRes = await fetch('https://fal.run/fal-ai/flux-pro/kontext/max/multi', {
  method: 'POST', headers: { Authorization: `Key ${fKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: PROMPT, image_urls, guidance_scale: 3.5, aspect_ratio: '16:9', seed: 11 }),
});
if (!fRes.ok) { console.error('fal', fRes.status, (await fRes.text()).slice(0, 400)); process.exit(1); }
const url = (await fRes.json()).images?.[0]?.url;
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
await writeFile('staging-refs/_out/guided-stage-vlm.png', buf);
console.log('SAVED -> staging-refs/_out/guided-stage-vlm.png');
