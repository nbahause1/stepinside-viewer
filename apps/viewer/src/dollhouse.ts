// Dollhouse ("Puppenhaus") ceiling cutaway.
//
// While the dollhouse camera orbits the flat from above, the ceiling is
// sliced away AT RENDER TIME by a horizontal clip plane — the streamed scan
// asset is untouched. The slice runs in the engine's official gsplat user
// hook (`gsplatModifyVS`): splats whose world centre sits above `uClipY`
// fade to alpha 0 across a small feather band, and splats just below the cut
// shrink toward the plane so their soft tails don't smear above the edge
// (that smear was the visibly "frayed" cut in the first prototype).
//
// The chunk is installed ONCE at init with the plane parked far above the
// ceiling (a visual no-op), so toggling the mode never recompiles shaders —
// entering/leaving dollhouse only tweens the uniform, which also gives the
// staged "the flat opens up" motion for free (Premium rule: no standstill).
//
// Uniform plumbing (hard-won prototyping insight): the unified renderer
// copies chunks AND parameters from `scene.gsplat.material` into its internal
// render material only when that material's dirty flag is raised —
// `setParameter` alone does NOT raise it, `material.update()` does. The
// engine's own GSplatParams setters (alphaClip & co) follow exactly this
// setParameter + update() pair, so we mirror it. Without the update() call
// the shader reads uClipY = 0 and clips the whole scan (black screen).

import { Vec3, type Entity, type GSplatComponent } from 'playcanvas';

import type { Global } from './types';

const tmpCorner = new Vec3();

// Feather band (m) over which a splat fades out at the FLOOR cut. Kept tight.
const FEATHER_M = 0.06;

// Top-edge treatment (all runtime-tunable uniforms, defaults dialled in on the
// demo scan): the wall top is where the ceiling-junction splats are noisiest,
// so a razor line always frays. Instead the top of the wall is made to
// dissolve cleanly — splats shrink hard toward the cut (uEdgeMin of their size
// at the plane, over uEdgeBand below it) AND their alpha tapers over uTopFade
// below the cut. Together the frizzy elongated wall-top splats collapse to a
// soft, deliberate fade rather than a jagged line.
const EDGE_MIN_DEFAULT = 0.05;   // scale at the cut (near-point → no upward smear)
const EDGE_BAND_DEFAULT = 0.5;   // m below cut over which shrink ramps back to 1
const TOP_FADE_DEFAULT = 0.28;   // m below cut over which alpha tapers to 0 at cut
const MAX_SCALE_DEFAULT = 0.2;   // per-axis splat scale cap (m) — collapses needle spikes
const MAX_SCALE_PARKED = 1000;   // no-op cap while NOT in dollhouse (walk stays untouched)

// Parked height: far above any interior — the clip is a no-op there.
const PARKED_Y = 1000;

// Entry/exit tween pacing (m/s toward the target, exponential ease).
const TWEEN_RATE = 6;

// Footprint (XZ) crop feather (m). Splats outside the room rectangle + margin
// fade out — this is what removes the outliers flying OUTSIDE the walls
// (window/balcony reflections, sensor noise) that the Y cut can't reach.
const FOOT_FEATHER_M = 0.12;

const wgslChunk = `
uniform uClipY: f32;
uniform uFloorY: f32;
uniform uMinX: f32;
uniform uMaxX: f32;
uniform uMinZ: f32;
uniform uMaxZ: f32;
uniform uEdgeMin: f32;
uniform uEdgeBand: f32;
uniform uTopFade: f32;
uniform uMaxScale: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {
}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    // 1) Global spike cap: the "Fransen" are individual splats with one huge
    // axis (needle-like) that stab out from walls/corners. Clamping the per-
    // axis scale to uMaxScale collapses those needles while normal splats
    // (well under the cap) are untouched. This is the main de-frizz lever.
    (*scale) = min(*scale, vec3f(uniform.uMaxScale));
    // 2) Shrink toward BOTH the ceiling cut and the footprint boundary, so
    // edge splats collapse to points (uEdgeMin) instead of smearing past.
    let yEdge = clamp((uniform.uClipY - originalCenter.y) / uniform.uEdgeBand, 0.0, 1.0);
    let xzDist = min(min(originalCenter.x - uniform.uMinX, uniform.uMaxX - originalCenter.x),
                     min(originalCenter.z - uniform.uMinZ, uniform.uMaxZ - originalCenter.z));
    let xzEdge = clamp(xzDist / uniform.uEdgeBand, 0.0, 1.0);
    let s = mix(uniform.uEdgeMin, 1.0, min(yEdge, xzEdge));
    (*scale) = (*scale) * s;
}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    let above = clamp((uniform.uClipY - center.y) / uniform.uTopFade, 0.0, 1.0);
    let below = clamp((center.y - uniform.uFloorY) / ${FEATHER_M}, 0.0, 1.0);
    let insideX = clamp((center.x - uniform.uMinX) / ${FOOT_FEATHER_M}, 0.0, 1.0)
                * clamp((uniform.uMaxX - center.x) / ${FOOT_FEATHER_M}, 0.0, 1.0);
    let insideZ = clamp((center.z - uniform.uMinZ) / ${FOOT_FEATHER_M}, 0.0, 1.0)
                * clamp((uniform.uMaxZ - center.z) / ${FOOT_FEATHER_M}, 0.0, 1.0);
    (*color).a = (*color).a * above * below * insideX * insideZ;
}
`;

const glslChunk = `
uniform float uClipY;
uniform float uFloorY;
uniform float uMinX;
uniform float uMaxX;
uniform float uMinZ;
uniform float uMaxZ;
uniform float uEdgeMin;
uniform float uEdgeBand;
uniform float uTopFade;
uniform float uMaxScale;
void modifySplatCenter(inout vec3 center) {
}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    scale = min(scale, vec3(uMaxScale));
    float yEdge = clamp((uClipY - originalCenter.y) / uEdgeBand, 0.0, 1.0);
    float xzDist = min(min(originalCenter.x - uMinX, uMaxX - originalCenter.x),
                       min(originalCenter.z - uMinZ, uMaxZ - originalCenter.z));
    float xzEdge = clamp(xzDist / uEdgeBand, 0.0, 1.0);
    scale *= mix(uEdgeMin, 1.0, min(yEdge, xzEdge));
}
void modifySplatColor(vec3 center, inout vec4 color) {
    float above = clamp((uClipY - center.y) / uTopFade, 0.0, 1.0);
    float below = clamp((center.y - uFloorY) / ${FEATHER_M}, 0.0, 1.0);
    float insideX = clamp((center.x - uMinX) / ${FOOT_FEATHER_M}, 0.0, 1.0)
                  * clamp((uMaxX - center.x) / ${FOOT_FEATHER_M}, 0.0, 1.0);
    float insideZ = clamp((center.z - uMinZ) / ${FOOT_FEATHER_M}, 0.0, 1.0)
                  * clamp((uMaxZ - center.z) / ${FOOT_FEATHER_M}, 0.0, 1.0);
    color.a *= above * below * insideX * insideZ;
}
`;

const initDollhouse = (global: Global) => {
    const { app, settings, events } = global;

    // The cut height: authored per property (settings.dollhouse.clipY), with a
    // bbox fallback for un-authored scans — 75% of the interior height lands
    // just above door frames on typical Altbau rooms.
    const authored = settings.dollhouse?.clipY;

    let clipY: number | null = (typeof authored === 'number' && Number.isFinite(authored)) ? authored : null;
    let current = PARKED_Y;
    let target = PARKED_Y;
    // Under-floor cut: capture outliers glitter BELOW the flat once the model
    // is seen from outside. The authored room lines run along the wall bases
    // (world floor height), so a plane just beneath them clips the sparkle.
    // Not animated — it sits under the visible floor either way.
    let floorClip = -PARKED_Y;
    // Top-edge shaping constants (exposed for live tuning; window.__dollhouseEdge
    // can override them in a ?debug session). Authorable per property later.
    let edgeMin = EDGE_MIN_DEFAULT;
    let edgeBand = EDGE_BAND_DEFAULT;
    let topFade = TOP_FADE_DEFAULT;
    // Parked by default so the scale cap NEVER touches walk mode — the chunk
    // stays installed after the first dollhouse visit, and an un-parked cap
    // would then quietly soften the first-person view too.
    let maxScale = MAX_SCALE_PARKED;
    // Footprint (XZ) crop bounds, parked to a huge box (no-op) when closed.
    const PARKED_XZ = { minX: -PARKED_Y, maxX: PARKED_Y, minZ: -PARKED_Y, maxZ: PARKED_Y };
    let foot = { ...PARKED_XZ };
    let installed = false;

    // The room rectangle in world XZ, from the authored floor lines, grown by
    // a margin so the WALLS (which sit on/just outside the floor outline) stay
    // while the outliers flying further out get cut. null when unauthored ->
    // the crop stays parked (no XZ clipping, only the Y cut).
    const FOOT_MARGIN_M = 0.5;
    const resolveFootprint = (): typeof PARKED_XZ | null => {
        const rooms = settings.rooms;
        if (!Array.isArray(rooms)) return null;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        let found = false;
        for (const room of rooms) {
            const lines = (room as { lines?: { a?: number[], b?: number[] }[] }).lines;
            if (!Array.isArray(lines)) continue;
            for (const line of lines) {
                for (const p of [line.a, line.b]) {
                    if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[2] === 'number') {
                        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
                        minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
                        found = true;
                    }
                }
            }
        }
        if (!found) return null;
        return {
            minX: minX - FOOT_MARGIN_M, maxX: maxX + FOOT_MARGIN_M,
            minZ: minZ - FOOT_MARGIN_M, maxZ: maxZ + FOOT_MARGIN_M
        };
    };

    const resolveFloorY = (): number | null => {
        const rooms = settings.rooms;
        if (!Array.isArray(rooms)) return null;
        let min = Infinity;
        for (const room of rooms) {
            const lines = (room as { lines?: { a?: number[], b?: number[] }[] }).lines;
            if (!Array.isArray(lines)) continue;
            for (const line of lines) {
                if (Array.isArray(line.a) && typeof line.a[1] === 'number') min = Math.min(min, line.a[1]);
                if (Array.isArray(line.b) && typeof line.b[1] === 'number') min = Math.min(min, line.b[1]);
            }
        }
        // Generous margin: the authored lines run along the wall BASE (a few
        // cm above the raw floor), and floor splat centres scatter another
        // ~10-15 cm below that — cutting too close visibly thins the parquet.
        // The under-floor sparkle sits far deeper (-0.5 m and below).
        return Number.isFinite(min) ? min - 0.3 : null;
    };

    // Resolved lazily: the gsplat entity exists only once the scene loaded.
    let splatEntity: Entity | null = null;

    const resolveEntity = (): Entity | null => {
        if (splatEntity) return splatEntity;
        splatEntity = app.root.findByName('gsplat') as Entity | null;
        return splatEntity;
    };

    // WORLD-space vertical bounds of the scan. The component's customAabb is
    // LOCAL, and the scan entity is rotated 180° around Z (y flipped!) — using
    // local heights directly put the clip plane below the flat and blanked the
    // whole scene. Transform all 8 corners and take the world-y range.
    const worldBounds = (): { floor: number; top: number } | null => {
        const entity = resolveEntity();
        const aabb = (entity as unknown as { gsplat?: GSplatComponent } | null)?.gsplat?.customAabb ?? null;
        if (!entity || !aabb) return null;
        const m = entity.getWorldTransform();
        const c = aabb.center;
        const h = aabb.halfExtents;
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < 8; i++) {
            tmpCorner.set(
                c.x + ((i & 1) ? h.x : -h.x),
                c.y + ((i & 2) ? h.y : -h.y),
                c.z + ((i & 4) ? h.z : -h.z)
            );
            m.transformPoint(tmpCorner, tmpCorner);
            min = Math.min(min, tmpCorner.y);
            max = Math.max(max, tmpCorner.y);
        }
        return { floor: min, top: max };
    };

    // Live edge-tuning hook (dev only): __dhEdge(min, band, fade) in a ?debug
    // console dials the top-edge shaping without a rebuild.
    if (global.config.devtools) {
        (window as unknown as { __dhEdge?: (m: number, b: number, f: number, cap?: number) => void }).__dhEdge =
            (m: number, b: number, f: number, cap?: number) => {
                edgeMin = m; edgeBand = b; topFade = f;
                if (typeof cap === 'number') maxScale = cap;
                pushUniform(); app.renderNextFrame = true;
            };
    }

    const resolveClipY = (): number => {
        if (clipY !== null) return clipY;
        const bounds = worldBounds();
        if (bounds) {
            // Rough net for un-authored scans. The aabb includes capture
            // outliers above the real ceiling, so cap the estimate well below
            // the top; authored settings.dollhouse.clipY beats this always.
            const h = bounds.top - bounds.floor;
            clipY = Math.min(bounds.floor + Math.max(1.8, h * 0.6), bounds.top - 0.8);
        } else {
            clipY = 2.4; // sane Altbau default; authored values beat this
        }
        return clipY;
    };

    // setParameter + update(): see the header comment — update() raises the
    // dirty flag the unified renderer polls before copying user parameters.
    const pushUniform = () => {
        const mat = (app.scene as unknown as {
            gsplat?: { material?: { setParameter(n: string, v: number): void, update(): void } }
        }).gsplat?.material;
        if (!mat) return;
        mat.setParameter('uClipY', current);
        mat.setParameter('uFloorY', floorClip);
        mat.setParameter('uMinX', foot.minX);
        mat.setParameter('uMaxX', foot.maxX);
        mat.setParameter('uMinZ', foot.minZ);
        mat.setParameter('uMaxZ', foot.maxZ);
        mat.setParameter('uEdgeMin', edgeMin);
        mat.setParameter('uEdgeBand', edgeBand);
        mat.setParameter('uTopFade', topFade);
        mat.setParameter('uMaxScale', maxScale);
        mat.update();
    };

    const install = () => {
        if (installed) return;
        installed = true;
        const scene = app.scene as unknown as {
            gsplat?: { material?: { getShaderChunks(lang: string): Map<string, string> } }
        };
        const mat = scene.gsplat?.material;
        if (!mat) return;
        mat.getShaderChunks('wgsl').set('gsplatModifyVS', wgslChunk);
        mat.getShaderChunks('glsl').set('gsplatModifyVS', glslChunk);
        pushUniform();
    };

    // Tween the plane toward its target. Exponential ease: fast start, gentle
    // settle — reads as the ceiling "peeling open" rather than a linear wipe.
    // While the cut is live (not parked) the uniform is pushed EVERY frame,
    // not just on change: WebGPU compiles the modified pipeline
    // asynchronously, and a push-on-change-only scheme raced it — the fresh
    // pipeline could arrive after the tween settled and then read zeroed
    // uniforms forever (observed as a fully clipped, black scan). The steady
    // push costs a tiny parameter copy per frame and only while the model
    // view is open.
    app.on('update', (dt: number) => {
        if (current === PARKED_Y && target === PARKED_Y) return;
        if (current !== target) {
            const k = Math.min(1, dt * TWEEN_RATE);
            current += (target - current) * k;
            if (Math.abs(current - target) < 0.005) current = target;
            app.renderNextFrame = true;
        }
        pushUniform();
    });

    // Camera-manager drives these around the dollhouse mode transitions.
    events.on('dollhouse:open', () => {
        install();
        const y = resolveClipY();
        // Start the sweep from just above the interior, not from the parked
        // kilometre — the visible part of the motion is ceiling -> cut.
        const bounds = worldBounds();
        const top = bounds ? (bounds.top + 0.4) : y + 2;
        if (current === PARKED_Y) current = top;
        target = y;
        floorClip = resolveFloorY() ?? -PARKED_Y;
        foot = resolveFootprint() ?? { ...PARKED_XZ };
        maxScale = MAX_SCALE_DEFAULT;
        pushUniform();
        app.renderNextFrame = true;
    });

    events.on('dollhouse:close', () => {
        if (!installed) return;
        // Sweep back up past the ceiling, then park (the parked no-op value
        // snaps in once the tween settles above the interior).
        const bounds = worldBounds();
        target = bounds ? (bounds.top + 0.6) : PARKED_Y;
        app.renderNextFrame = true;
    });

    // Once the exit sweep has cleared the interior, park the plane exactly so
    // the per-frame work stops (the update handler's early-out).
    app.on('update', () => {
        if (target !== PARKED_Y && current === target && global.state.cameraMode !== 'dollhouse') {
            const bounds = worldBounds();
            if (bounds && current > bounds.top) {
                current = PARKED_Y;
                target = PARKED_Y;
                floorClip = -PARKED_Y;
                foot = { ...PARKED_XZ };
                maxScale = MAX_SCALE_PARKED;
                pushUniform();
            }
        }
    });
};

export { initDollhouse };
