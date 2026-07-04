# ComfyUI Staging Workflow — node graph design

The graph to build in the ComfyUI UI, then export as **API format** to
`staging-workflow.api.json` (that JSON is what `../test-comfyui.mjs` sends). We
build it in the UI rather than hand-writing the JSON because node IDs/wiring are
error-prone by hand — the UI validates connections and fills defaults.

Two layers: the **established base** (proven public recipe) + our **custom
additions** (floor-mask inpaint + IP-Adapter reference furniture).

## A. Established base — furnish + lock architecture

Straight from the Superteams / ComfyUI interior recipe (proven). Start here and
confirm the room shell stays put before adding our layer.

```
LoadImage(room)
  ├─► DepthAnythingV2Preprocessor (ckpt = vitb / Base!) ─► ControlNet-Union (mode: depth)
  └─► CannyEdgePreprocessor (low 0.4, high 0.8) ────────► ControlNet-Union (mode: canny)

CheckpointLoaderSimple(sd_xl_base_1.0) ─► MODEL / CLIP / VAE
CLIPTextEncode(positive = style placement prompt)
CLIPTextEncode(negative = "changed walls, altered windows, moved doors, new
               architecture, cartoon, cgi, 3d render, watermark, text")

ControlNetApplyAdvanced(depth):  strength 0.55, start 0.0, end 0.40
ControlNetApplyAdvanced(canny):  strength 0.25, start 0.0, end 0.30   (chained after depth)

VAEEncode(room) ─► LATENT
KSampler: steps 30-40, cfg 6-8, sampler dpmpp_2m, scheduler karras, denoise 0.72
VAEDecode ─► SaveImage
```

> Note: the reference recipe uses steps 150 / cfg 17 — needlessly heavy. Start at
> **~35 steps, cfg ~7**; raise only if quality demands. `denoise 0.72` is the key
> knob: high enough to furnish, low enough to keep the room. Tune 0.6–0.8.

## B. Our custom layer

### B1. Floor-mask inpaint (Approach A — pixel-stable architecture)
Instead of denoising the whole frame, only repaint the furnishable area so
walls/windows/doors stay **literally identical** (what the scan↔furnished toggle
needs).

```
GroundingDinoSAMSegment(room, prompt = "floor")     ─► floor MASK
  (grow the mask upward a little so furniture can rise off the floor:
   GrowMask / feather ~15-30 px)
SetLatentNoiseMask(latent = VAEEncode(room), mask = floor)  ─► masked LATENT
  -> feed this masked latent to the KSampler above.
```
Only the masked region is generated; everything else is passed through untouched.

### B2. IP-Adapter — our exact designer furniture
This is the layer the plain recipe lacks (it invents generic furniture). Inject
the style's real Vitra/USM reference photos.

```
IPAdapterUnifiedLoader(model = SDXL, preset = PLUS)          ─► ip_model
IPAdapterEncode(ref images = staging-refs/<style>/*.jpg)     ─► embeds
IPAdapterApply(model, embeds, weight 0.6-0.9, weight_type "style transfer")
  -> the IP-Adapter-patched MODEL feeds the KSampler.
```
`weight` is the fidelity/creativity trade-off — tune **per style** (brief §11:
this is the R&D part). Multiple reference images = pass them as a batch.

## Inputs the harness injects (node ids to fill after building)
Record these node ids in `../test-comfyui.mjs` (`NODES` map) after export:
- `room` LoadImage — the captured empty-room frame
- positive `CLIPTextEncode` — the style placement text (server-owned, from `staging-prompt.ts`)
- IP-Adapter reference images — the style's `staging-refs/<dir>/<refs>`
- output `SaveImage` — where we read the result from `/history`

## Output contract (must match today's /stage)
Return one furnished image aligned to the input frame (so the toggle lines up).
Keep `pickAspectRatio` behaviour: request the output at the frame's aspect.
