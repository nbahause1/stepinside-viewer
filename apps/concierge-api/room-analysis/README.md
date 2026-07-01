# Room analysis (Step 1 of AI staging v2)

Reads the actual room geometry from the 3D scan so furniture can be placed
**room-aware** (not scattered). This is our unfair advantage over 2D-photo
competitors — see `docs/ai-virtual-staging-v2-plan.md`.

## Pipeline
```
SOGS splat (apps/website/public/viewer/scene/*)     ← 12 tiles, per-tile means_l/u.webp
  → decode + dequantize positions  (validated exact, see decode-tile.mjs)
  → floor plane (Y-histogram peak), room bbox, top-down occupancy (3cm)
  → despeckle + largest-connected-free-region = room, erode 15cm = placeable
  → top-down free-space map (staging-refs/_out/room-analysis.png)

drone frame (apps/concierge-api/staging-frame.jpg, captured via
  ../../trailer-render/capture-staging-frame.mjs)
  → detect-openings-2d.mjs : Florence-2 (fal) window/door detection

fuse-layout.mjs : fuse 3D free-space + 2D openings → sofa wall + placement plan
  → staging-refs/_out/layout-plan.png + layout-plan.json
```

## Files
- `analyze-scene.mjs` — 3D: decode splat → floor plan + free/placeable + wall openings (top-down)
- `decode-tile.mjs` — validates the SOGS means decode against one tile's meta bounds
- `debug-wall.mjs` — prints a wall's vertical point profile as ASCII (calibration)
- `../detect-openings-2d.mjs` — 2D window/door detection (Florence-2 via fal)
- `../fuse-layout.mjs` — fusion → room-aware layout plan on the frame

## Known limits / TODO (the "not perfect" list)
- **Paths are hardcoded** to this machine (scratchpad cache, ffmpeg-static, scene
  dir). Make them repo-relative before CI use. Point cloud is cached to a `.bin`.
- Window/door detection **from the splat is unreliable** (photogrammetry glass is
  see-through; this demo scan is partial) → we use the **2D** detector instead.
- Layout planning is currently **heuristic zones** for the FIXED aerial viewpoint.
  Better: an LLM/VLM or layout model (LayoutGPT / I-Design / Gemini 3 Pro) — and a
  metric projection of the 3D placeable area into image space.
- Validate on **multiple, ideally LiDAR/ARKit (metric)** scans.

## Candidate off-the-shelf replacements (researched, to simplify/improve)
- Splat→geometry: `3DGS-to-PC` + Open3D; or the scan source's floor plan (Polycam/ARKit/Matterport).
- Room layout from one image: HorizonNet / room-layout-estimation.
- Furniture arrangement: LayoutGPT, ATISS, DiffuScene, EditRoom, I-Design, InteriorAgent.
