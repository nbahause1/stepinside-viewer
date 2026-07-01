# StepInside — Cinematic Trailer Renderer

Turns a 3D Gaussian-splat scan (the `apps/viewer` / `public/viewer` scene) into a
smooth, cinematic **trailer video** by flying a virtual camera through it and
rendering it offline to an MP4. Runs **locally, for free** (no cloud, no license).

> **Status:** working proof-of-concept. Produces a butter-smooth 60fps 1080p
> master + a 4K upscale. It's **semi-automatic** (you scout the path, then run a
> command). Full automation ("one click per property") is a future step.

---

## Quick start

```bash
# 0. One-time: install deps (downloads a headless Chromium + ffmpeg)
cd apps/trailer-render
npm install

# 1. The dev server must be running (it serves the viewer + scene):
#    in another terminal:  cd apps/website && npx next dev -H 0.0.0.0 -p 3000

# 2. Smooth the camera path (constant speed, no waypoint judder):
node smooth-path.mjs

# 3. Render the trailer (1080p @ 60fps by default here):
DPR=1 node render.mjs
#    -> stepinside-trailer.mp4  (set OUT=... to rename)

# 4. (optional) upscale to 4K with sharpening:
node_modules/ffmpeg-static/ffmpeg -i stepinside-trailer.mp4 \
  -vf "scale=3840:2160:flags=lanczos,unsharp=5:5:0.6:5:5:0.0" \
  -c:v libx264 -crf 19 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  stepinside-trailer-4k.mp4
```

Test a single frame first with `node render.mjs --probe` → `probe.png`.

---

## Authoring the camera path (scouting)

The path is a keyframed camera animation stored in
`apps/website/public/viewer/settings.trailer.json` under `animTracks[0]`
(`startMode: "animTrack"`). Each keyframe = `position`, `target` (look-at) and
`fov` over time (spline-interpolated — see `apps/viewer/src/core/spline.ts`).

To pick good viewpoints, open the **normal** viewer with the built-in scout tool:

```
http://localhost:3000/viewer/index.html?debug&scout
```

Fly around (press `2` for fly mode), frame nice shots, click **📍 Punkt aufnehmen**
for each (in path order, 4–6 points), then **Kopieren** and paste the JSON into
`settings.trailer.json`'s `animTracks[0].keyframes`.

**Lessons that matter:**
- Keep camera height **< ~2.5 m** (the ceiling is ~2.8 m; above it there are no
  splats → broken/empty imagery). Keep look-targets ~1.4 m (not the floor).
- Points that are only for the concierge Q&A (POIs) are **not** good cinematic
  focal points — scout fresh ones for the flythrough.

`scout` and `record` are inert dev helpers injected into `index.html`, gated by
URL param (`?scout`, `?record`) — they do nothing in normal use.

---

## How the pipeline works (and why)

1. **Path → constant speed.** `smooth-path.mjs` re-samples the few scout points
   (via the exact engine spline) into ~180 keyframes spaced at **equal arc length
   with even times** → constant camera speed. Without this the camera decelerates
   at each waypoint (visible as periodic "judders"). Output:
   `settings.trailer.smooth.json` (render.mjs prefers it if present).
2. **Slow-shoot.** `render.mjs` plays the animation **`SLOWMO`× slower** (default 8×)
   in headless Chrome. Slow playback = many rendered frames per unit of motion →
   smooth even on modest hardware (each frame is fully rendered, nothing dropped
   to keep real time).
3. **Timestamped capture.** Every painted frame is grabbed via CDP screencast and
   its **real timestamp** recorded.
4. **Timestamp-accurate encode.** ffmpeg assembles the frames using their real
   timestamps (concat demuxer, per-frame durations, mapped back to original speed
   by `/SLOWMO`) and conforms to constant 60fps → **perfectly even motion**.
   (Encoding at an assumed uniform rate produced a constant micro-judder; the
   timestamps fixed it.)
5. **Upscale.** Optional lanczos scale to 4K + light unsharp.

### The three fixes that made it smooth
1. **Slow-shoot** (many frames per motion) — smoothness without a render farm.
2. **Per-frame timestamps** — even motion despite an uneven capture rate.
3. **Constant-speed path** — no deceleration at waypoints.

---

## The 4K caveat (important)

Headless Chrome here **cannot create a WebGL context at a window larger than
~1080p** (`NO-WEBGL`). `DPR=2` supersampling makes `page.screenshot` render true
4K, **but `Page.startScreencast` still captures at the window size (1080p)** — so
the *video* path maxes out at 1080p, and we **upscale** to 4K.

For **true native 4K + perfect 60fps** the next step is the *deterministic* method:
drive the animation with a controlled clock (CDP virtual time) and take one 4K
`page.screenshot` per frame (no real-time capture). Not built yet — the upscale
was accepted as good enough for mobile/social/web.

---

## Config (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `WIDTH`×`HEIGHT` | 1920×1080 | capture window (keep ≤1080p — see caveat) |
| `DPR` | 2 | supersampling for `--probe` screenshots; screencast ignores it |
| `SLOWMO` | 8 | animation slowdown during capture |
| `TARGET_FPS` | 60 | output frame rate |
| `OUT` | stepinside-trailer.mp4 | output file |

## Files

- `render.mjs` — the renderer (capture + encode).
- `smooth-path.mjs` — constant-speed path resampler.
- `frames/`, `frames-list.txt`, `*.mp4`, `*.png` — generated, gitignored.

## TODO / next steps

- Music + brand intro/outro; 9:16 (Reels) format.
- True native 4K (deterministic virtual-time capture).
- Productize: one command / auto-trigger per property, output storage.
