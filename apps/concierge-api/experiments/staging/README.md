# Staging R&D experiments (archived)

Standalone scripts from the virtual-staging research arc (2026-07-01..04).
None of these run in production — the winning pipeline lives in
`src/staging-planner.ts` + `src/staging.ts`. Kept for reference:

- `vlm-nano-stage.mjs` — the BREAKTHROUGH: Gemini plans layout, Nano Banana
  renders. Superseded by src/staging-planner.ts.
- `stage-grounded.mjs` — planning grounded on 3D room facts (room-analysis/).
- `stage-candidates.mjs` + `test-scorer*.mjs` — N candidates + VLM auto-score.
- `declutter.mjs` — empty a furnished room (for furnished customer scans).
- `detect-openings-2d.mjs`, `fuse-layout.mjs`, `vlm-layout.mjs`,
  `experiment-guided-stage.mjs` — earlier planner iterations.
- `eval-fal-kontext*.mjs`, `test-comfyui.mjs` — engine evaluations (FLUX
  Kontext via fal, self-hosted ComfyUI; both superseded by Gemini).
- `run-pipeline.mjs` — end-to-end orchestrator of the script era.
- `test-staging.mjs` — early /stage endpoint smoke test.
- `staging-frame.jpg` — the captured demo drone frame all of these eat.

Run with: node --env-file=../../.dev.vars <script>
