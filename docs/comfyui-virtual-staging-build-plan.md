# StepInside — Virtual Staging Pipeline (Self-Hosted ComfyUI) — Build Brief

> **Purpose of this document.** This is a self-contained hand-off for a fresh session
> with no prior context. It explains *what* we are building, *why*, *how* it fits the
> existing codebase, the *exact technical stack*, the *step-by-step build plan*, and the
> *cost model*. Read it top to bottom, then start at "Build steps". Anything marked
> **DECIDE** is an open choice; anything marked **VERIFY** must be checked against current
> model/provider docs before relying on it.

---

## 1. TL;DR — what to build

Replace the current single-call Gemini image model with a **self-hosted, geometry-conditioned
virtual-staging pipeline** running on **ComfyUI** on a rented **GPU server (RunPod, EU region)**.

The pipeline takes a photo of a room and returns the same room furnished, with:
- **architecture locked** (walls / windows / doors / floor stay pixel-stable), and
- **our own designer furniture** (Vitra / USM) placed from reference images.

It is wired into the existing backend so the **viewer and the user experience do not change** —
only what the `/stage` endpoint calls underneath changes (Gemini → our ComfyUI server).

**Why self-host and not just a prompt or a paid API:** see §4. Short version: prompt-only
(current Gemini) cannot reliably control layout or lock architecture; no proven paid API
supports *our own reference furniture*; self-hosting is the only path that keeps the designer-
furniture differentiator **and** gives EU/GDPR control and cents-per-image cost.

---

## 2. Background — the product and current state

**StepInside** scans real-estate properties as 3D Gaussian-splat tours and embeds them in a web
viewer. One feature, **"Möbliert sehen"** (AI virtual staging / "AI Reframe"), lets a visitor see
an empty scanned room furnished.

**Current pipeline (what exists today):**

```
Viewer "Möbliert sehen" pill
  → capture current frame (a 2D render of the empty room)
  → POST to concierge-api  /stage
  → Google Gemini "Nano Banana" (model id: gemini-3-pro-image), image-to-image
  → furnished still, overlaid on the live scan with a scan↔furnished toggle
```

The model is fed: the captured empty-room frame **plus** real designer-furniture reference
photos (Vitra/USM cutouts) for the chosen style, and a server-owned text prompt. Feeding real
reference furniture is what lifted output from generic "AI furniture" to designer-grade.

**Production mode:** the live website currently runs staging in **DEMO mode** — pre-generated
images are bundled and shipped as static JPGs; visitors do **not** trigger the model. The
backend is not deployed to production for staging (demo needs no endpoint).

**The problem that triggered this project:** Gemini is a single end-to-end model. It does **not**
plan space — furniture is scattered or clustered, and the architecture can drift between the scan
and the furnished frame. Better prompts help only marginally (see §4). **Goal now:** make staging
reliable enough to run **live per customer room** (arbitrary uploaded rooms, not just our one demo
room). That requires a real geometry-conditioned pipeline, which is this build.

---

## 3. Key code locations (existing system)

All under repo root `apps/`:

| Path | What it is |
|---|---|
| `apps/concierge-api/src/staging.ts` | Backend staging brain. `handleStaging()` validates, rate-limits, resolves style, loads references, calls `generateWithGemini()`. **This is the file where we swap Gemini for our ComfyUI server.** |
| `apps/concierge-api/src/staging-prompt.ts` | Server-owned styles + prompt. `STAGING_STYLES` (ids `classic`/`scandi`/`warm`), each with reference filenames + placement text; `buildStagingPrompt()`, `METHODOLOGY`, `PRESERVE`. |
| `apps/concierge-api/src/staging-validation.ts` | Input caps / validation for `/stage`. |
| `apps/concierge-api/staging-refs/` | The real reference furniture images. Folders: `set1-vitra-klassiker`, `set2-usm-vitra-minimal`, `set3-colour-pop`. **Reuse these as IP-Adapter inputs.** |
| `apps/concierge-api/test-staging.mjs` | Standalone Node harness that calls the model server-side with room + refs and saves the result. **Mirror this pattern to test the ComfyUI pipeline without the browser.** |
| `apps/concierge-api/src/worker.ts` / `dev-server.ts` / `vercel.ts` | Three entry points that route `/stage` vs `/concierge`. The Cloudflare/Vercel/Node hosts. |
| `apps/viewer/src/staging.ts` + `src/index.html` + `public/settings.json` | Viewer-side: frame capture, the pill/overlay, the `staging` config block (incl. `mode: demo` and per-style `image`/`imagePortrait`). **No change needed for this build** — the viewer just POSTs to `/stage`. |

The client only ever sends a **style id** (+ the captured frame). The server owns the prompt and
reference set. Keep that boundary: a client must never be able to inject prompt content.

---

## 4. The decision — why this approach

We evaluated three levers and chose to build the real pipeline. Recorded here so the new session
does not re-litigate it.

- **Prompt-only (current Gemini).** Improving the text prompt (we added a staging "methodology"
  block) gives a marginal lift but **cannot** reliably fix layout or lock architecture, because
  Gemini is end-to-end with no geometry control. Dead end for "live per customer room".
- **Buy a finished API.** The genuinely proven players (Virtual Staging AI, Styldod/REimagineHome,
  Collov, BoxBrownie) use **preset styles only** — they do **not** accept our own reference
  furniture, so we lose the designer-furniture differentiator. The one API that *does* take custom
  reference furniture (MeltFlex) is young and states no GDPR/EU residency. No single vendor gives
  {own designer furniture + documented EU-GDPR + maturity}.
- **Build it ourselves (CHOSEN, "Path B").** The proven open-source building blocks, assembled in
  ComfyUI, are the **only** path that keeps our designer furniture **and** gives EU/GDPR control
  **and** cents-per-image cost. It is also exactly the architecture the paid players wrap.

**Honest caveats to carry forward:**
1. The geometry scaffolding (depth + floor mask + ControlNet) reliably fixes **architecture lock**
   and **furniture grounding**. *Perfect logical arrangement* remains the hardest part industry-
   wide; the paid leaders are better at it mainly because they trained on real staging data, not a
   secret technique. Expect arrangement to need iteration.
2. ComfyUI is just the **self-built / owned** version of a pipeline you can also rent pre-assembled
   (fal.ai / Replicate). We build it ourselves specifically to combine **our reference furniture +
   our masking + EU hosting** in one place, which the rented endpoints don't do together.

---

## 5. Architecture — the pipeline and how it slots in

**Where it slots in (only the middle changes):**

```
Viewer (unchanged) → concierge-api /stage (unchanged contract)
    → [NEW] HTTP call to our ComfyUI server on RunPod (EU)
        1. Depth estimation        (understand the room in 3D)
        2. Segmentation → floor/furniture mask  (lock architecture)
        3. Generate furniture, constrained to the floor region,
           conditioned on our reference furniture images
    → furnished image returned → /stage returns it → viewer overlays as today
```

**Two model strategies to choose between (DECIDE early, then commit):**

- **Strategy 1 — SDXL + Multi-ControlNet (classic, most control).**
  SDXL base + Depth-ControlNet + Canny-ControlNet, floor mask via segmentation, reference
  furniture via **IP-Adapter**. This is the documented, proven ComfyUI recipe. Maximum control
  over the masking/structure.
- **Strategy 2 — FLUX.1 Kontext [dev] (modern, simpler).**
  A strong open image-editing model that natively takes reference images. Fewer moving parts,
  often better base quality; less granular structural control than multi-ControlNet. Heavier VRAM.

**Recommendation:** prototype **Strategy 2 (FLUX Kontext)** first for base quality with our
references, then add depth/mask scaffolding if architecture lock isn't tight enough; fall back to
**Strategy 1** if FLUX can't hold the architecture. Validate on our real Altbau room.

---

## 6. Technical stack (open-source building blocks)

All free / open source. Run inside **ComfyUI** (the node-graph runtime). **VERIFY** exact model
files/versions against current Hugging Face / ComfyUI registries at build time.

| Role | Component | Notes |
|---|---|---|
| Runtime | **ComfyUI** | node-graph engine; run **headless via its HTTP API**, no GUI clicking in prod |
| Generator | **SDXL** (Strategy 1) **or** **FLUX.1 Kontext [dev]** (Strategy 2) | the "brain" |
| Architecture lock | **ControlNet** depth (e.g. `control-lora-depth`) + canny | locks lines/perspective (Strategy 1) |
| Depth | **Depth-Anything-V2** | spatial structure, furniture-on-floor grounding |
| Segmentation | **SAM / Grounded-SAM** (SAM + Grounding DINO) | derive floor / furniture mask |
| Reference furniture | **IP-Adapter** (Strategy 1) or Kontext reference input (Strategy 2) | inject our Vitra/USM designer pieces |
| (optional) object removal | inpainting model | only if input rooms may already be furnished |

Existing assets to reuse: the reference furniture in `apps/concierge-api/staging-refs/` and the
three styles already defined in `staging-prompt.ts` (`classic` / `scandi` / `warm`).

---

## 7. Build steps (phased)

**Phase 0 — Spec & prep (free, no GPU running).**
- Confirm Strategy 1 vs 2 (§5). List exact model files. Write the ComfyUI workflow JSON design.

**Phase 1 — Stand up the GPU server.**
- Create a **RunPod** account (EU region for GDPR). Add a little prepaid credit.
- Deploy a **Pod** with a ComfyUI template for development (hourly, switch OFF between sessions).
  Recommended dev GPU: 24 GB (e.g. RTX 4090, ~$0.40/hr) for SDXL; 48 GB (e.g. L40S, ~$0.79/hr) if
  using FLUX Kontext. **VERIFY** current RunPod templates/prices.
- Access model: expose the pod over **SSH**; the building session drives install/setup over SSH
  (no manual GUI work).

**Phase 2 — Build & tune the workflow.**
- Install ComfyUI + the §6 models (script).
- Build the workflow: room → depth → floor/furniture mask → generate (constrained) with our
  reference furniture → output. Save as a JSON workflow file (version it in the repo, e.g.
  `apps/concierge-api/comfyui/staging-workflow.json`).
- Run ComfyUI in **API mode** and drive it from a Node test script that mirrors
  `apps/concierge-api/test-staging.mjs`: send our real Altbau room + `staging-refs` per style,
  save outputs, eyeball **arrangement + architecture lock**. Iterate.

**Phase 3 — Integrate into the backend.**
- In `apps/concierge-api/src/staging.ts`, add a `generateWithComfyUI()` alongside
  `generateWithGemini()` and switch `handleStaging()` to it (keep Gemini behind a flag for
  fallback/comparison). Reuse `loadStyleReferences()` to pass the reference furniture to ComfyUI.
- Keep the `/stage` request/response contract identical so the viewer is untouched.

**Phase 4 — Productionize.**
- Move from hourly Pod to **RunPod Serverless** (scale-to-zero) for live, EU region.
- Add retries on cold start / transient errors (mirror the existing Gemini 503-retry logic in
  `staging.ts`). Decide warm-worker policy vs accept cold-start latency (the viewer pre-generates
  in the background, so some latency is hidden).
- Point the deployed `/stage` at the serverless endpoint; set the API key as a server-side secret.

---

## 8. Integration contract (don't break this)

- Client sends only `{ style: id, imageBase64, mimeType, width, height }` to `/stage` (as today).
- Server resolves the style → server-owned prompt + reference furniture (never trust client text).
- `pickAspectRatio(width,height)` logic should be preserved so the output lines up with the live
  scan for the scan↔furnished toggle.
- Output: a furnished image (data URL or URL) the viewer overlays. Architecture must stay aligned
  with the input frame or the toggle looks wrong — this is *the* reason architecture lock matters.

---

## 9. Cost model (realistic estimates)

Assumptions: **Serverless GPU, EU region, ~25 s/image, ~2-5 cents/image** all-in (compute +
cold-start overhead). Ranges, not exact. **VERIFY** provider prices at build time.

**Develop (one-time):** ~30-50 h active GPU time over 2-4 weeks × ~€0.50-0.80/h + a little storage
→ **roughly €40-80 total.** GPU is OFF between sessions, so idle costs nothing.

**Live (low volume), per month:**

| Images / month | Cost / month |
|---|---|
| 100 | ~€3-5 |
| 500 | ~€12-25 |
| 1,000 | ~€25-50 |

Plus a small fixed storage fee (~€5-10/mo). **Realistic early total: ~€15-40/month.**

**Scaling:**

| Images / month | Serverless | Alternative |
|---|---|---|
| 5,000 | ~€80-180 | |
| 10,000 | ~€150-350 | or 1 always-on GPU ~€530 fixed |
| 50,000+ | ~€800-2,500 | multiple GPUs / always-on |

**Crossover:** serverless (pay-per-image) stays cheapest until a single GPU would run nearly 24/7
— roughly **25,000-30,000 images/month**. Below that, always pay per image.

**Per-image vs market:** traditional staging €16-75/image; finished AI APIs €0.20-0.47/image;
**this pipeline ~€0.02-0.05/image.**

**Cost rules:** you pay only while the GPU is ON. Dev = a few tens of euros. Live serverless =
idle is free, pay per real image. Expensive (~€500+/mo) only if a GPU runs 24/7, which you do only
at high volume that funds it.

---

## 10. GDPR / EU

Customer property photos are personal-data-adjacent. Host the GPU in a **RunPod EU region** and
keep all processing there. This is a core reason for self-hosting over US-based APIs (fal.ai /
Replicate are US). When going live with real customer rooms, document the data flow (where images
are processed, retention) and ensure no third party stores customer images.

---

## 11. Open decisions & risks

- **DECIDE:** Strategy 1 (SDXL + Multi-ControlNet) vs Strategy 2 (FLUX Kontext). Prototype both on
  the real room before committing.
- **DECIDE:** warm-worker (instant, costs more) vs scale-to-zero (cheaper, cold-start latency).
- **RISK:** *arrangement quality* is the hard part — geometry fixes architecture, not necessarily
  perfect layout. Budget iteration; consider a layout-first step later (research: DiffuScene,
  DeBaRA) if needed.
- **RISK:** reference-furniture fidelity via IP-Adapter needs tuning per style; it is R&D, not
  plug-and-play.
- **VERIFY:** all model versions, RunPod templates, and prices are current at build time.

---

## 12. Reference material

**Existing assets in this repo:**
- Brief: `docs/ai-virtual-staging-brief.md`
- Backend: `apps/concierge-api/src/staging.ts`, `staging-prompt.ts`, `staging-validation.ts`
- Reference furniture: `apps/concierge-api/staging-refs/{set1-vitra-klassiker,set2-usm-vitra-minimal,set3-colour-pop}`
- Test harness pattern: `apps/concierge-api/test-staging.mjs`

**Proven open-source building blocks (adoption = GitHub stars, not SEO):**
- ComfyUI (~119k★) — runtime
- ControlNet `lllyasviel/ControlNet` (~34k★)
- Segment Anything `facebookresearch/segment-anything` (~54k★), Grounded-SAM (~18k★)
- Depth-Anything-V2 (~8k★, NeurIPS 2024)

**Reference workflow (proves the recipe is real):**
- "AI Virtual Staging with ComfyUI" — superteams.ai blog (SDXL + depth + canny ControlNet +
  Depth-Anything-V2). Add IP-Adapter for reference furniture.

**Hosting / model providers (prices to VERIFY):**
- RunPod (GPU pods + serverless, EU regions) — chosen host
- fal.ai (FLUX.1 Kontext [dev], ~$0.025/megapixel) — US, only if renting the model
- Replicate (per-second GPU) — US alternative

---

*End of brief. Start at §7 (Build steps), Phase 0.*
