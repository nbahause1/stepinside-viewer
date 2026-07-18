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

// Feather band (m) over which a splat fades out at the cut. Kept tight so the
// edge reads as a deliberate section cut, not a gradient.
const FEATHER_M = 0.06;

// Splats within this band BELOW the cut shrink (down to SHRINK_MIN of their
// size at the plane itself) — kills the upward smear of large wall-top splats.
const SHRINK_BAND_M = 0.35;
const SHRINK_MIN = 0.3;

// Parked height: far above any interior — the clip is a no-op there.
const PARKED_Y = 1000;

// Entry/exit tween pacing (m/s toward the target, exponential ease).
const TWEEN_RATE = 6;

const wgslChunk = `
uniform uClipY: f32;
uniform uFloorY: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {
}
fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    let edge = clamp((uniform.uClipY - originalCenter.y) / ${SHRINK_BAND_M}, 0.0, 1.0);
    let s = mix(${SHRINK_MIN}, 1.0, edge);
    (*scale) = (*scale) * s;
}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    let above = clamp((uniform.uClipY - center.y) / ${FEATHER_M}, 0.0, 1.0);
    let below = clamp((center.y - uniform.uFloorY) / ${FEATHER_M}, 0.0, 1.0);
    (*color).a = (*color).a * above * below;
}
`;

const glslChunk = `
uniform float uClipY;
uniform float uFloorY;
void modifySplatCenter(inout vec3 center) {
}
void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    float edge = clamp((uClipY - originalCenter.y) / ${SHRINK_BAND_M}, 0.0, 1.0);
    scale *= mix(${SHRINK_MIN}, 1.0, edge);
}
void modifySplatColor(vec3 center, inout vec4 color) {
    float above = clamp((uClipY - center.y) / ${FEATHER_M}, 0.0, 1.0);
    float below = clamp((center.y - uFloorY) / ${FEATHER_M}, 0.0, 1.0);
    color.a *= above * below;
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
    let installed = false;

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
                pushUniform();
            }
        }
    });
};

export { initDollhouse };
