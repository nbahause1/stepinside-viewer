# AI Virtual Staging v2 — Plan: reliable per-room staging from the scan

> Supersedes the ComfyUI/self-host direction. Goal: when a customer has a 3D
> scan, the "Möbliert sehen" feature furnishes **any** room **correctly for that
> room's actual geometry** — reliably (not "guaranteed perfect"; no generative
> model guarantees that), using our unfair advantage: **we have the 3D scan**.

## 0. Honest framing
- **No generative model guarantees** perfect arrangement on every room — not the
  market leaders, not Nano Banana. The target is **reliability**, built in layers,
  with a **human/auto approval gate** before anything customer-facing (exactly what
  Styldod does, and what the original brief `ai-virtual-staging-brief.md` §3 already
  specified: curated viewpoints, human-checked, "kein KI-Müll live").
- **Our edge:** competitors infer room geometry from a single 2D photo and must
  guess. We **have the scan** → we can derive real depth, the floor plane and the
  free space **per room**, and condition the model on it. That is what makes
  "richtig einrichten nach den räumlichen Gegebenheiten" actually generalize.

## 1. Target pipeline (scan → approved furnished image)
```
Customer 3D scan (Gaussian splat)
  1. Pick 1–4 good viewpoints (we control the camera; reuse aerial poses)
  2. Per viewpoint, from the SCAN derive geometry:
       - depth map        (grounding + scale)
       - floor / free-space mask  (where furniture may go; keep windows/doors clear)
  3. Staging model furnishes, geometry-conditioned + our furniture:
       - Backbone now:  FLUX Kontext (fal), our reference furniture as inputs
       - Moat later:    our own trained LoRA (our furniture + staging style)
  4. Generate N candidates (e.g. 3–4)
  5. Quality gate: auto-score + human approve the best  ← the reliability lever
  6. Publish the approved image (overlay via cross-fade, per original brief §7)
```

## 2. Two model tracks
### Track A — Backbone (ship now, no training, no server)
Managed API (**fal FLUX Kontext [max] multi**, validated 2026-07-01): takes the
captured frame + our Vitra/USM reference photos, returns a furnished image that
already places our exact pieces well. `/stage` calls it; contract unchanged.
- Cost ~$0.05–0.08/image. Commercial license included in the API.
- Data residency: fal is US → enterprise DPA; empty/staged rooms are low-risk
  personal data; current DEMO mode ships pre-generated stills (no live customer
  data at all). EU-cleaner alt: BFL's own API (German company). Revisit at scale.

### Track B — Moat (build in parallel): our own staging LoRA
Train an **edit/Kontext-style LoRA** on **our furniture + our staging style** so
placement becomes consistent and unmistakably ours, at ~$0.03–0.05/image.
- **Dataset:** 15–30 `*_start`(empty) / `*_end`(furnished) pairs, ≥1024px, stable
  instruction captions. Quality ≫ quantity.
- **Bootstrap the dataset with Track A** (generate many staged variants, cull the
  best) — a documented workflow (NanoBanana/Kontext dataset generators exist).
  Optionally add real staged photos / 3D renders of our furniture.
- **Train on fal** (`flux-kontext-trainer` / `flux-lora-fast-training`, ~$2/run,
  ~1000–2000 steps, rank 32–64, lr ~1e-4..4e-4). One-time ~$15–40 total.
- **Honest caveat:** the LoRA is only as good as the curated bootstrap set
  (garbage in → garbage out). Curation is the real effort, not money.

## 3. Geometry track (the generalization key) — derive per room from the scan
The viewer already renders the splat headlessly (see
`apps/trailer-render/capture-staging-frame.mjs`, which flies to a fixed aerial
pose and grabs the frame). Extend it to also export, per viewpoint:
- **Depth** — from the splat/renderer depth buffer (preferred, true geometry) or,
  as a fallback, a monocular depth estimate on the captured frame.
- **Floor / free-space mask** — floor plane from the splat geometry; project free
  floor area (minus door/window swing zones) into the frame.

Feed these to the model:
- With FLUX (Track A): via fal's FLUX + depth-ControlNet / Fill (mask) endpoints,
  or as strong guidance. Start WITHOUT geometry (Kontext already reads rooms well);
  add depth/free-space conditioning only where placement/scale needs it.
- With our LoRA (Track B): same conditioning, learned placement on top.

**Why this generalizes:** the depth + free-space mask are computed *per customer
room from their scan*, not a fixed template — so "recognize the room + arrange to
its spatial reality" holds for arbitrary rooms, which single-photo competitors cannot do.

## 4. Reliability gate (no "KI-Müll live")
- Generate 3–4 candidates per viewpoint.
- **Auto-score** (cheap heuristics/model): architecture preserved? furniture on
  floor? not blocking windows/doors? not duplicated?
- **Human approve** the best for MVP (Styldod-style). Curated viewpoints only
  (1–4/room), not arbitrary live angles.
- Only approved images are published; overlay via **cross-fade** (tolerates the
  slight re-render drift) per `ai-virtual-staging-brief.md` §7.

## 5. Build phases
| Phase | Deliverable | Status |
|---|---|---|
| **1. Backbone** | `generateWithFalKontext()` in concierge-api behind a `STAGING_ENGINE` flag; `/stage` runs live on FLUX Kontext with our refs. Contract unchanged, Gemini kept as fallback. | ← building now |
| **2. Dataset** | Batch generator: many staged candidates from our room(s)/styles for LoRA curation. | next |
| **3. LoRA** | Train our edit-LoRA on fal from the curated set; swap it in behind the flag. | after curation |
| **4. Geometry** | Export depth + free-space mask per viewpoint from the splat; condition the model. | parallel R&D |
| **5. Gate + multi-room** | Candidate generation + auto-score + human approval; validate across several DIFFERENT rooms before "live per customer room". | before GA |

## 6. Validation (must-do before promising "any room")
Test the whole path on **multiple, diverse rooms** — not just the one Altbau demo.
Reliability is only proven when it holds across varied geometries.

## 7. Housekeeping
- The RunPod SDXL pod is obsolete for this plan → **stop it** (Pods → Stop) to
  save cost. Models persist if we ever want it back.
- `FAL_KEY` stays server-side (in `.dev.vars` locally; a secret in prod).
