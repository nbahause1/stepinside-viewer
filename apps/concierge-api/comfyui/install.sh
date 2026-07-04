#!/usr/bin/env bash
# One-shot setup for a fresh RunPod pod (Ubuntu + CUDA, >=24 GB GPU).
# Installs ComfyUI, the custom nodes, and the commercial-safe model set for the
# StepInside virtual-staging pipeline (Strategy 1: SDXL + ControlNet + IP-Adapter).
#
# Usage (over SSH on the pod):
#   bash install.sh
# then:
#   cd ComfyUI && python main.py --listen 0.0.0.0 --port 8188
#
# NOTE: every model URL is marked VERIFY where the exact filename/repo should be
# re-checked against Hugging Face at build time. ~15-30 GB of downloads.
set -euo pipefail

ROOT="${COMFY_ROOT:-$HOME/ComfyUI}"
dl() { # dl <url> <dest>  — download only if missing
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then echo "  exists: $dest"; return; fi
  mkdir -p "$(dirname "$dest")"
  echo "  get: $dest"
  wget -q --show-progress -O "$dest" "$url"
}

echo "==> 1. ComfyUI"
if [[ ! -d "$ROOT" ]]; then
  git clone https://github.com/comfyanonymous/ComfyUI "$ROOT"
fi
cd "$ROOT"
pip install -q -r requirements.txt

echo "==> 2. Custom nodes"
cd "$ROOT/custom_nodes"
clone() { [[ -d "$(basename "$1" .git)" ]] || git clone --depth 1 "$1"; }
clone https://github.com/ltdrdata/ComfyUI-Manager.git
clone https://github.com/Fannovel16/comfyui_controlnet_aux.git      # Depth-Anything, Canny preprocessors
clone https://github.com/cubiq/ComfyUI_IPAdapter_plus.git           # reference-furniture injection
clone https://github.com/storyicon/comfyui_segment_anything.git     # Grounding-DINO + SAM floor mask  (VERIFY: maintained fork if needed)
# install any node requirements that exist
for d in comfyui_controlnet_aux comfyui_segment_anything; do
  [[ -f "$d/requirements.txt" ]] && pip install -q -r "$d/requirements.txt" || true
done

echo "==> 3. Models"
cd "$ROOT"
HF="https://huggingface.co"

# Generator (SDXL base) + fp16-safe VAE
dl "$HF/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors" \
   "models/checkpoints/sd_xl_base_1.0.safetensors"
dl "$HF/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl_vae.safetensors" \
   "models/vae/sdxl_vae.safetensors"

# Structural ControlNet — xinsir Union (depth+canny+more in one, saves VRAM).  VERIFY exact filename.
dl "$HF/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors" \
   "models/controlnet/controlnet-union-sdxl-promax.safetensors"

# IP-Adapter (SDXL Plus) + its CLIP-ViT-H image encoder
dl "$HF/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" \
   "models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors"
dl "$HF/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
   "models/clip_vision/CLIP-ViT-H-14.safetensors"

# Depth-Anything-V2 (Base = Apache) and SAM/Grounding-DINO are auto-downloaded by
# their nodes on first run. IMPORTANT: in the DepthAnythingV2 node pick the *Base*
# checkpoint (depth_anything_v2_vitb), NOT Large (vitl) — Large is CC-BY-NC.

echo ""
echo "==> Done. Start the server with:"
echo "    cd $ROOT && python main.py --listen 0.0.0.0 --port 8188"
echo "Then build the graph per workflow-design.md and export staging-workflow.api.json."
