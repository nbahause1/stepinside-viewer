<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. The website lives in `apps/website`; read the relevant guide in `apps/website/node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Cinematic trailer renderer

`apps/trailer-render/` turns a Gaussian-splat scan into a smooth cinematic
trailer MP4 (offline, local). See `apps/trailer-render/README.md` for the full
pipeline, the camera-path scouting workflow, and the "3 fixes that made it
smooth" (constant-speed path + slow-shoot + timestamped capture). Note the 4K
caveat: headless WebGL caps the video at 1080p, so 4K is currently an upscale.
