# StepInside — Self-hosted Virtual Staging (ComfyUI)

Phase-0 preparation for migrating **"Möbliert sehen"** from the single Gemini
call to a self-hosted, geometry-conditioned ComfyUI pipeline (see the build brief
and `docs/ai-virtual-staging-brief.md`). Strategy 1: **SDXL + Multi-ControlNet +
IP-Adapter**, fully commercially licensed, runs on a rented RunPod GPU (EU/GDPR).

> **Status:** design + install tooling only. Nothing here has run on a GPU yet.
> Every model version / URL is marked **VERIFY** where it must be re-checked at
> build time (registries move).

## What this pipeline does

```
empty room frame (captured by the live viewer, see ../../viewer/src/staging.ts)
  ├─ Depth-Anything-V2 (Base) ─► Depth-ControlNet ┐  ground furniture on the floor
  ├─ Canny ────────────────────► Canny-ControlNet ┤  freeze walls/windows/doors
  └─ Grounded-SAM ("floor") ───► inpaint mask ────┤  only the floor area is repainted
                                                   ▼
  our Vitra/USM reference photos ─► IP-Adapter ─► SDXL ─► furnished image
```

The **established base** (SDXL + depth + canny ControlNet) is the proven public
recipe (Superteams / ComfyUI interior workflows). Our **only custom layer** is the
IP-Adapter branch that injects *our* designer furniture + the floor-mask inpaint
(Approach A) that keeps the architecture pixel-stable for the scan↔furnished toggle.

## Files here

| File | What |
|---|---|
| `README.md` | this — overview + the exact model list |
| `install.sh` | one-shot setup for a fresh RunPod pod: ComfyUI + custom nodes + models |
| `workflow-design.md` | the node graph (nodes, wiring, parameters) to build in ComfyUI |
| `../test-comfyui.mjs` | Node harness that drives the ComfyUI HTTP API (mirrors `test-staging.mjs`) |

## Exact model list

All Apache-2.0 / OpenRAIL (commercial-safe). **The one landmine:** use
Depth-Anything-V2 **Base**, NOT Large (Large is CC-BY-NC → non-commercial).

| Role | Model / repo | File | ComfyUI folder | License |
|---|---|---|---|---|
| Generator | `stabilityai/stable-diffusion-xl-base-1.0` | `sd_xl_base_1.0.safetensors` | `models/checkpoints/` | OpenRAIL++-M |
| VAE (fp16 fix) | `madebyollin/sdxl-vae-fp16-fix` | `sdxl_vae.safetensors` | `models/vae/` | MIT |
| Struct. ControlNet | `xinsir/controlnet-union-sdxl-1.0` (depth+canny in one) | `…promax.safetensors` **VERIFY** | `models/controlnet/` | Apache-2.0 |
| Depth preproc | Depth-Anything-V2 **Base** (via `comfyui_controlnet_aux`) | auto-download | node cache | Apache-2.0 |
| Ref furniture | `h94/IP-Adapter` (SDXL plus) | `ip-adapter-plus_sdxl_vit-h.safetensors` | `models/ipadapter/` | Apache-2.0 |
| Image encoder | `h94/IP-Adapter` image_encoder (CLIP-ViT-H) | `CLIP-ViT-H-14.safetensors` | `models/clip_vision/` | Apache-2.0 |
| Floor mask | SAM ViT-H + Grounding DINO (`comfyui_segment_anything`) | auto-download | node cache | Apache-2.0 |

Later quality upgrade (Phase 2, license-check first): swap the checkpoint for a
photoreal SDXL finetune (Juggernaut XL / RealVisXL) — drop-in, same graph.

## How to use (Phase 1)

```bash
# On the RunPod pod (Ubuntu, GPU, ≥24 GB), over SSH:
bash install.sh                 # installs ComfyUI + nodes + models (~15-30 GB download)
cd ComfyUI && python main.py --listen 0.0.0.0 --port 8188   # start the API server

# Build/validate the graph in the ComfyUI UI per workflow-design.md, then
# "Save (API Format)" -> comfyui/staging-workflow.api.json.

# From your machine (tunnel 8188), drive it headlessly:
cd apps/concierge-api
COMFY_URL=http://localhost:8188 node test-comfyui.mjs staging-frame.jpg classic
```
