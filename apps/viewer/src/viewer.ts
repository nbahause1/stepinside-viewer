import {
    BoundingBox,
    CameraFrame,
    type CameraComponent,
    Color,
    type Entity,
    type Layer,
    RenderTarget,
    Mat4,
    MiniStats,
    ShaderChunks,
    PIXELFORMAT_RGBA16F,
    PIXELFORMAT_RGBA32F,
    TONEMAP_NONE,
    TONEMAP_LINEAR,
    TONEMAP_FILMIC,
    TONEMAP_HEJL,
    TONEMAP_ACES,
    TONEMAP_ACES2,
    TONEMAP_NEUTRAL,
    Vec3,
    GSPLAT_DEBUG_LOD,
    GSPLAT_DEBUG_NONE,
    GSPLAT_RENDERER_RASTER_CPU_SORT,
    GSPLAT_RENDERER_RASTER_GPU_SORT,
    GSplatComponent,
    platform
} from 'playcanvas';

import { Annotations } from './annotations';
import { verifyScale } from './calibration';
import { CameraManager, isWalkAllowed } from './camera-manager';
import { Camera } from './cameras/camera';
import { IdleLook } from './cameras/idle-look';
import type { Collision } from './collision';
import { MeshCollision, VoxelCollision } from './collision';
import { nearlyEquals } from './core/math';
import type { DebugPanel } from './debug';
import { InputController } from './input-controller';
import { initMeasure } from './measure';
import { initRoomDimensions } from './room-dimensions';
import { MeshDebugOverlay } from './mesh-debug-overlay';
import { NavCursor } from './nav-cursor';
import { Picker } from './picker';
import type { ExperienceSettings, PostEffectSettings } from './settings';
import type { Config, Global } from './types';
import { VoxelDebugOverlay } from './voxel-debug-overlay';

// String.replace wrapper that warns when the source substring is missing, so
// shader chunk patches against the engine fail loudly instead of silently
// producing the original chunk.
const patchChunk = (source: string, search: string, replacement: string, name: string): string => {
    if (!source.includes(search)) {
        console.warn(`patchChunk: substring not found in '${name}', shader chunk patch may be out of sync with the engine.`);
    }
    return source.replace(search, replacement);
};

const gammaChunkGlsl = `
vec3 prepareOutputFromGamma(vec3 gammaColor, float depth) {
    return gammaColor;
}
`;

const gammaChunkWgsl = `
fn prepareOutputFromGamma(gammaColor: vec3f, depth: f32) -> vec3f {
    return gammaColor;
}
`;

const rendererTable: Record<Config['renderer'], number> = {
    'webgl': GSPLAT_RENDERER_RASTER_CPU_SORT,
    'webgpu': GSPLAT_RENDERER_RASTER_GPU_SORT
};

type GSplatOctreeResourceLike = {
    octree?: {
        lodLevels: number;
    } | null;
};

const tonemapTable: Record<string, number> = {
    none: TONEMAP_NONE,
    linear: TONEMAP_LINEAR,
    filmic: TONEMAP_FILMIC,
    hejl: TONEMAP_HEJL,
    aces: TONEMAP_ACES,
    aces2: TONEMAP_ACES2,
    neutral: TONEMAP_NEUTRAL
};

const applyPostEffectSettings = (cameraFrame: CameraFrame, settings: PostEffectSettings) => {
    if (settings.sharpness.enabled) {
        cameraFrame.rendering.sharpness = settings.sharpness.amount;
    } else {
        cameraFrame.rendering.sharpness = 0;
    }

    const { bloom } = cameraFrame;
    if (settings.bloom.enabled) {
        bloom.intensity = settings.bloom.intensity;
        bloom.blurLevel = settings.bloom.blurLevel;
    } else {
        bloom.intensity = 0;
    }

    const { grading } = cameraFrame;
    if (settings.grading.enabled) {
        grading.enabled = true;
        grading.brightness = settings.grading.brightness;
        grading.contrast = settings.grading.contrast;
        grading.saturation = settings.grading.saturation;
        grading.tint = new Color().fromArray(settings.grading.tint);
    } else {
        grading.enabled = false;
    }

    const { vignette } = cameraFrame;
    if (settings.vignette.enabled) {
        vignette.intensity = settings.vignette.intensity;
        vignette.inner = settings.vignette.inner;
        vignette.outer = settings.vignette.outer;
        vignette.curvature = settings.vignette.curvature;
    } else {
        vignette.intensity = 0;
    }

    const { fringing } = cameraFrame;
    if (settings.fringing.enabled) {
        fringing.intensity = settings.fringing.intensity;
    } else {
        fringing.intensity = 0;
    }
};

const anyPostEffectEnabled = (settings: PostEffectSettings): boolean => {
    return (settings.sharpness.enabled && settings.sharpness.amount > 0) ||
        (settings.bloom.enabled && settings.bloom.intensity > 0) ||
        (settings.grading.enabled) ||
        (settings.vignette.enabled && settings.vignette.intensity > 0) ||
        (settings.fringing.enabled && settings.fringing.intensity > 0);
};

const vec = new Vec3();

// store the original isColorBufferSrgb so the override in updatePostEffects is idempotent
const origIsColorBufferSrgb = RenderTarget.prototype.isColorBufferSrgb;

class Viewer {
    global: Global;

    cameraFrame: CameraFrame;

    inputController: InputController;

    cameraManager: CameraManager;

    picker: Picker;

    annotations: Annotations;

    forceRenderNextFrame = false;

    voxelOverlay: VoxelDebugOverlay | null = null;

    meshOverlay: MeshDebugOverlay | null = null;

    navCursor: NavCursor | null = null;

    debugPanel: DebugPanel | null = null;

    origChunks: {
        glsl: {
            gsplatOutputVS: string,
            skyboxPS: string
        },
        wgsl: {
            gsplatOutputVS: string,
            skyboxPS: string
        }
    };

    constructor(global: Global, gsplatLoad: Promise<Entity>, skyboxLoad: Promise<void> | undefined, collisionLoad: Promise<Collision> | undefined) {
        this.global = global;

        const { app, settings, config, events, state, camera, renderer } = global;
        const { graphicsDevice } = app;

        // Effective "constrained device" flag for the perf profile. PlayCanvas'
        // platform.mobile is false on iPadOS (it reports a desktop UA), so an
        // iPad would otherwise take the full desktop splat budget and fail to
        // load — index.html's UA check (config.mobile, which includes the
        // iPad maxTouchPoints probe) catches it; fall back to platform.mobile
        // when the entry point didn't provide the flag.
        const mobile = config.mobile ?? platform.mobile;
        // Fill-rate-limited DESKTOP (Macs: Apple-Silicon/integrated TBDR GPUs,
        // phone-like fill-rate ceilings behind a desktop UA). Gets the mobile
        // dynamic-resolution-while-moving path + mild overdraw culling, but
        // keeps desktop budgets, LOD reach and input. See index.html detection.
        const fillRateLimited = !mobile && (config.fillrate ?? false);

        // render skybox as plain equirect
        const glsl = ShaderChunks.get(graphicsDevice, 'glsl');
        glsl.set('skyboxPS', patchChunk(glsl.get('skyboxPS'), 'mapRoughnessUv(uv, mipLevel)', 'uv', 'glsl skyboxPS'));

        const wgsl = ShaderChunks.get(graphicsDevice, 'wgsl');
        wgsl.set('skyboxPS', patchChunk(wgsl.get('skyboxPS'), 'mapRoughnessUv(uv, uniform.mipLevel)', 'uv', 'wgsl skyboxPS'));

        this.origChunks = {
            glsl: {
                gsplatOutputVS: glsl.get('gsplatOutputVS'),
                skyboxPS: glsl.get('skyboxPS')
            },
            wgsl: {
                gsplatOutputVS: wgsl.get('gsplatOutputVS'),
                skyboxPS: wgsl.get('skyboxPS')
            }
        };

        // disable auto render, we'll render only when camera changes
        app.autoRender = false;

        // configure the camera
        this.configureCamera(settings);

        // reconfigure camera when entering/exiting XR
        app.xr.on('start', () => this.configureCamera(settings));
        app.xr.on('end', () => this.configureCamera(settings));

        // construct debug ministats
        if (config.ministats) {
            const options = MiniStats.getDefaultOptions() as any;
            options.cpu.enabled = false;
            options.stats = options.stats.filter((s: any) => s.name !== 'DrawCalls');
            options.stats.push({
                name: 'VRAM',
                stats: ['vram.tex'],
                decimalPlaces: 1,
                multiplier: 1 / (1024 * 1024),
                unitsName: 'MB',
                watermark: 1024
            }, {
                name: 'Splats',
                stats: ['frame.gsplats'],
                decimalPlaces: 3,
                multiplier: 1 / 1000000,
                unitsName: 'M',
                watermark: 5
            });

            // eslint-disable-next-line no-new
            new MiniStats(app, options);
        }

        const prevProj = new Mat4();
        const prevWorld = new Mat4();
        const sceneBound = new BoundingBox();
        let settleFrames = 0; // consecutive still frames, for mobile dynamic resolution
        // Hero-still: timestamp of the last real camera movement; once the camera
        // has been fully still for HERO_DELAY_MS we ramp to full detail (see the
        // heroStill handling in applyPerfSettings + index.ts's resolution cap).
        let lastMoveMs = 0;
        const HERO_DELAY_MS = 200;
        // Position-stable: the finest LOD (the "mushy close-up" fix) is tied to
        // the camera POSITION, not its orientation — so looking around on the
        // spot stays sharp while only the (cheaper) budget/resolution wait for a
        // full stop. Tracks the last real translation.
        const prevPos = new Vec3();
        let lastTranslateMs = 0;
        // Short so the finest LOD starts streaming the instant you stop walking
        // (the click-to-walk glide decelerates below POS_EPS just before the
        // full stop, so this often fires mid-deceleration → sharp on arrival).
        const POS_STABLE_MS = 60;
        const POS_EPS = 0.03; // world units (~3 cm) — ignores sub-pixel jitter

        // Track whether a finger/pointer is down so mobile dynamic resolution can
        // hold low res for the whole gesture: during a slow drag the per-frame
        // camera delta can fall below the change threshold, and a motion-only
        // check would then flip to full res mid-drag (heavy frame + canvas
        // realloc = stutter). Capture-phase + window so we still see the release
        // if the input controller stops propagation or the finger lifts off-canvas.
        let pointerActive = false;
        if (mobile || fillRateLimited) {
            const down = () => {
                pointerActive = true;
            };
            const up = () => {
                pointerActive = false;
            };
            const canvasEl = app.graphicsDevice.canvas;
            canvasEl.addEventListener('pointerdown', down, { capture: true });
            window.addEventListener('pointerup', up, { capture: true });
            window.addEventListener('pointercancel', up, { capture: true });
            canvasEl.addEventListener('touchstart', down, { capture: true, passive: true });
            window.addEventListener('touchend', up, { capture: true });
            window.addEventListener('touchcancel', up, { capture: true });
        }

        // low-tier frame pacing (see the cap below)
        const FRAME_CAP_MS = 1000 / 30;
        let lastLowTierRenderMs = 0;
        const now = () => performance.now();

        // track the camera state and trigger a render when it changes
        app.on('framerender', () => {
            const world = camera.getWorldTransform();
            const proj = camera.camera.projectionMatrix;

            const cameraChanged =
                !nearlyEquals(world.data, prevWorld.data) ||
                !nearlyEquals(proj.data, prevProj.data);

            if (!app.renderNextFrame) {
                if (config.ministats || cameraChanged) {
                    app.renderNextFrame = true;
                }
            }

            // Dynamic resolution: half scale while interacting (smooth), full
            // scale once settled (a sharp still image). While a finger is
            // down we need many more still frames before settling, so a slow drag
            // that dips below the change threshold never flips to full res
            // mid-gesture; once the finger lifts we settle in ~2 frames for a
            // snappy sharpen. The large pointer-down threshold also rescues a
            // missed release (sharpens after a held still moment). The resize
            // happens in initCanvas's apply(); we just flip the flag and force one
            // full-res render on settle. Runs on mobile AND fill-rate-limited
            // desktops (Macs); discrete-GPU desktops are left untouched.
            if (mobile || fillRateLimited) {
                // The idle look-around moves the camera but should stay sharp, so
                // it must NOT count as user movement — only a real camera change
                // (not the idle wander) keeps the resolution low.
                if (cameraChanged && !IdleLook.wandering) {
                    settleFrames = 0;
                    global.cameraMoving = true;
                } else if (global.cameraMoving && ++settleFrames >= (pointerActive ? 14 : 2)) {
                    global.cameraMoving = false;
                    app.renderNextFrame = true;
                }
            }

            // Hero-still refinement (all devices): once the camera has been fully
            // still briefly, ramp to full detail (finest LOD + higher budget +
            // sharper desktop resolution) for a crisp "hero" frame — this is
            // exactly when a viewer studies a room. ANY real camera movement
            // reverts instantly so motion stays on the cheap, smooth profile.
            // Gated to the live scene (not during load / the staging prewarm).
            if (cameraChanged && !IdleLook.wandering) {
                lastMoveMs = now();
                if (state.heroStill) {
                    state.heroStill = false;
                }
            } else if (!state.heroStill && state.readyToRender && !state.prewarming &&
                now() - lastMoveMs > HERO_DELAY_MS) {
                state.heroStill = true;
            }

            // Position-stable: keep the finest LOD while merely LOOKING AROUND
            // (rotating on the spot). Only a real TRANSLATION resets it, so the
            // near-field sharpness survives a rotate — budget/resolution still
            // wait for a full stop (above), keeping the rotation itself smooth.
            const posMoved = camera.getPosition().distance(prevPos) > POS_EPS;
            if (posMoved && !IdleLook.wandering) {
                prevPos.copy(camera.getPosition());
                lastTranslateMs = now();
                if (state.positionStable) {
                    state.positionStable = false;
                }
            } else if (!state.positionStable && state.readyToRender && !state.prewarming &&
                now() - lastTranslateMs > POS_STABLE_MS) {
                state.positionStable = true;
            }

            // suppress rendering till we're ready
            if (!state.readyToRender) {
                app.renderNextFrame = false;
            }

            if (this.forceRenderNextFrame) {
                app.renderNextFrame = true;
            }

            // Low-tier 30fps cap — THE anti-thermal lever on weak devices:
            // 60->30fps cuts GPU energy by 40-100% (heat is cumulative, and
            // these devices throttle into a death spiral otherwise). Skipped
            // frames merely postpone: prevWorld is only advanced on rendered
            // frames, so a pending camera change re-triggers next tick.
            if (mobile && state.deviceTier === 'low' && app.renderNextFrame) {
                const nowMs = now();
                if (nowMs - lastLowTierRenderMs < FRAME_CAP_MS - 1) {
                    app.renderNextFrame = false;
                } else {
                    lastLowTierRenderMs = nowMs - ((nowMs - lastLowTierRenderMs) % FRAME_CAP_MS);
                }
            }

            if (app.renderNextFrame) {
                prevWorld.copy(world);
                prevProj.copy(proj);
            }
        });

        const applyCamera = (camera: Camera) => {
            const cameraEntity = global.camera;

            cameraEntity.setPosition(camera.position);
            // Add the walk-mode gaze offset here, at the render entity only, so
            // the navigation (which reads camera.angles) never sees it.
            cameraEntity.setEulerAngles(
                camera.angles.x + camera.gazePitch,
                camera.angles.y + camera.gazeYaw,
                camera.angles.z
            );
            cameraEntity.camera.fov = camera.fov;

            cameraEntity.camera.horizontalFov = graphicsDevice.width > graphicsDevice.height;

            // fit clipping planes to bounding box
            const boundRadius = sceneBound.halfExtents.length();

            // calculate the forward distance between the camera to the bound center
            vec.sub2(sceneBound.center, camera.position);
            const dist = vec.dot(cameraEntity.forward);

            const far = Math.max(dist + boundRadius, 1e-2);
            const near = Math.max(dist - boundRadius, far / (1024 * 16));

            cameraEntity.camera.farClip = far;
            cameraEntity.camera.nearClip = near;
        };

        // handle application update
        app.on('update', (deltaTime) => {
            // in xr mode we leave the camera alone
            if (app.xr.active) {
                return;
            }

            if (this.inputController && this.cameraManager) {
                // update inputs
                this.inputController.update(deltaTime, this.cameraManager.camera.distance);

                // update cameras
                this.cameraManager.update(deltaTime, this.inputController.frame);

                // apply to the camera entity
                applyCamera(this.cameraManager.camera);
            }

        });

        // Render voxel debug overlay
        app.on('prerender', () => {
            this.voxelOverlay?.update();
        });

        // update state on first frame
        events.on('firstFrame', () => {
            state.loaded = true;
            state.animationPaused = !!config.noanim;

            window.scrubTo = (time: number) => {
                if (!state.hasAnimation) {
                    return Promise.reject(new Error('No animation track'));
                }

                state.animationPaused = true;
                return new Promise<void>((resolve) => {
                    events.fire('scrubAnim', time);
                    app.renderNextFrame = true;
                    app.once('frameend', () => resolve());
                });
            };

            window.animationDuration = state.animationDuration;
        });

        // wait for the model to load
        Promise.all([gsplatLoad, skyboxLoad, collisionLoad]).then((results) => {
            const gsplatComponent = results[0].gsplat as GSplatComponent;
            const collision = results[2];

            // get scene bounding box
            const gsplatBbox = gsplatComponent.customAabb;
            if (gsplatBbox) {
                sceneBound.setFromTransformedAabb(gsplatBbox, results[0].getWorldTransform());
            }

            if (!config.noui) {
                this.annotations = new Annotations(global, this.cameraFrame != null);
            }

            this.picker = new Picker(app, camera);
            this.inputController = new InputController(global, this.picker);
            this.inputController.collision = collision ?? null;

            // distance measurement tool (uses the same picker + collision)
            initMeasure(global, this.picker, collision ?? null);

            // authored room dimensions ("Raummaße"), shown in the bird's-eye view
            initRoomDimensions(global);

            // Automatic tour generation — authoring tool, dynamically imported
            // so its ~360 lines never reach the visitor bundle.
            if (config.devtools) {
                import('./tour-generator').then(({ initTourGenerator }) => {
                    initTourGenerator(global, collision ?? null);
                }).catch(() => { /* authoring-only, never break the viewer */ });
            }

            // verify the scan is at true metric scale (warns if mis-scaled, so a
            // bad scan is caught before its measurements/floor plan mislead anyone)
            verifyScale(global);

            // hasCollision = collision data exists (drives fly-mode collision
            // detection and the voxel/mesh debug overlay availability).
            // walkAllowed = walk mode is offered to the user; requires both
            // collision data and a scene large enough to walk around in.
            state.hasCollision = !!collision;
            state.walkAllowed = isWalkAllowed(sceneBound, collision ?? null);

            // Create collision debug overlay (voxel uses a compute shader, mesh
            // uses standard line rendering). The voxel path requires WebGPU.
            if (collision instanceof VoxelCollision && renderer !== 'webgl') {
                this.voxelOverlay = new VoxelDebugOverlay(app, collision, camera);
                this.voxelOverlay.mode = config.heatmap ? 'heatmap' : 'overlay';
                state.hasCollisionOverlay = true;

                events.on('collisionOverlayEnabled:changed', (value: boolean) => {
                    this.voxelOverlay.enabled = value;
                    app.renderNextFrame = true;
                });
            } else if (collision instanceof MeshCollision) {
                this.meshOverlay = new MeshDebugOverlay(app, collision, camera, !!this.cameraFrame);
                state.hasCollisionOverlay = true;

                events.on('collisionOverlayEnabled:changed', (value: boolean) => {
                    this.meshOverlay.enabled = value;
                    app.renderNextFrame = true;
                });
            }

            this.cameraManager = new CameraManager(global, sceneBound, collision);
            applyCamera(this.cameraManager.camera);

            if (!config.noui) {
                this.navCursor = new NavCursor(app, camera, collision ?? null, events, state);
            }

            // developer panel (exposes window.getCameraState/setCameraState) —
            // authoring/tooling entry points only; dynamically imported so the
            // whole debug/ folder stays out of the visitor bundle
            if (config.devtools) {
                import('./debug').then(({ DebugPanel }) => {
                    this.debugPanel = new DebugPanel(global, this.cameraManager);
                }).catch(() => { /* authoring-only, never break the viewer */ });
            }

            const { gsplat } = app.scene;

            // Desktop quality budget (millions of splats, by performance
            // mode). Mobile budgets live in budget() below, keyed by the
            // device tier — numbers follow the 2026 industry consensus
            // (PlayCanvas docs, Spark, WebSplatter measurements): ~1M splats
            // is the ceiling an iPhone renders fluidly, and thermal
            // throttling takes 30-50% off peak within minutes, so they
            // target sustained, not cold-start performance.
            // Desktop now has a tier ladder too (it used to be a flat 4M): a
            // weak / thermally-throttled Mac or an integrated-GPU laptop can't
            // sustain 4M splats, and desktop has no touch heuristic to know
            // that up front — so it starts at 'high' and the runtime demotes
            // it (high -> mid -> low) exactly like mobile when the measured
            // fps can't hold. performanceMode forces one notch lower.
            const budgets = {
                desktop: {
                    low: 1.0,
                    mid: 2.0,
                    high: 4
                }
            };
            const isWebglMobile = mobile && renderer === 'webgl';

            // The LOD range knobs live on the COMPONENT in 2.20.5 — the
            // scene-level lodRangeMin/Max setters are deprecated no-op stubs
            // (getter returns a constant), so writing them does nothing.
            const splatComponent = results[0].gsplat;

            const applyPerfSettings = () => {
                const tier = state.deviceTier;
                const budget = () => {
                    if (config.budget !== undefined && Number.isFinite(config.budget) && config.budget > 0) {
                        return config.budget;
                    }
                    if (state.heroStill) {
                        // Camera settled → render the "hero" still at full detail.
                        // Bounded per tier so a static frame never blows memory on
                        // weak devices (the full asset is ~5.4M splats). This is a
                        // still frame, so it need not sustain 60fps.
                        if (!mobile) return tier === 'high' ? 5.4 : (tier === 'mid' ? 3.5 : 2.0);
                        if (isWebglMobile) return 0.9;
                        return tier === 'low' ? 0.6 : (tier === 'mid' ? 1.6 : 2.8);
                    }
                    if (!mobile) {
                        const base = budgets.desktop[tier] ?? budgets.desktop.high;
                        // performanceMode = manual "run lighter": one notch down.
                        return state.performanceMode ? base * 0.6 : base;
                    }
                    if (tier === 'low') {
                        // 12-mini class: sustained-thermal target, not peak.
                        return 0.35;
                    }
                    if (isWebglMobile) {
                        // CPU-sorted path without per-chunk frustum culling —
                        // old devices get the hard cap.
                        return state.performanceMode ? 0.4 : 0.6;
                    }
                    if (tier === 'high') {
                        // 14 Pro/15/16/17 class proved it renders 1M at 1080px
                        // fluidly — quality IS the product on these devices.
                        return state.performanceMode ? 1 : 1.5;
                    }
                    return state.performanceMode ? 0.6 : 0.8;
                };

                gsplat.splatBudget = budget() * 1000000;
                // Mobile GPUs (TBDR) blend EVERY overlapping splat fragment —
                // fill rate is the bottleneck, so: never stream the finest LOD
                // near the camera (halves close-range splats), cull
                // low-contribution splats GPU-side, clip near-zero alpha
                // earlier, and thin the periphery slightly (walk mode centres
                // the gaze anyway). Desktop keeps maximum quality.
                if (splatComponent) {
                    // Finest LOD (the "mushy close-up" fix) is tied to POSITION
                    // stability, not a full stop — so looking around on the spot
                    // stays sharp up to the camera. Mobile low stays a level up
                    // for memory. Real translation (walking) keeps the cheaper
                    // floor to bound streaming/fill while moving through space.
                    splatComponent.lodRangeMin = state.positionStable ?
                        ((mobile && tier === 'low') ? 1 : 0) :
                        ((tier === 'low' || isWebglMobile) ? 2 : (mobile ? 1 : 0));
                    splatComponent.lodRangeMax = 1000;
                }
                gsplat.colorUpdateAngle = (mobile && tier === 'low') || state.performanceMode ? 4 : 2;
                // Anti-overdraw ladder: harsh culling reads as thinned-out,
                // "washed" splats — only the weakest devices get the harsh
                // values; high-tier phones stay near desktop quality.
                // Fill-rate-limited desktops (Macs) take the high-tier-phone
                // values: visually near-identical, but real fill-rate savings
                // on exactly the overdraw-bound GPUs that need them.
                gsplat.minContribution = !mobile ? (fillRateLimited ? 2 : 1) : (tier === 'low' ? 8 : (tier === 'mid' ? 3 : 2));
                gsplat.alphaClip = !mobile ? (fillRateLimited ? 2 / 255 : 1 / 255) : (tier === 'low' ? 8 / 255 : (tier === 'mid' ? 4 / 255 : 2 / 255));
                gsplat.foveationStrength = !mobile ? 0 : (tier === 'low' ? 0.5 : (tier === 'mid' ? 0.25 : 0));
                gsplat.antiAlias = config.aa && tier !== 'low';
            };

            if (config.fullload) {
                // reveal once full quality has finished loading (used for screenshots)
                applyPerfSettings();
            } else {
                // reveal once low lod has loaded for fastest possible reveal
                const resource = results[0].gsplat.resource as GSplatOctreeResourceLike | null;
                const lodLevels = resource?.octree?.lodLevels;
                if (lodLevels && splatComponent) {
                    splatComponent.lodRangeMax = splatComponent.lodRangeMin = lodLevels - 1;
                }
            }

            // these two allow LOD behind camera to drop, saves lots of splats
            gsplat.lodUpdateAngle = 90;
            gsplat.lodBehindPenalty = 5;

            // same performance, but rotating on slow devices does not give us unsorted splats on sides
            gsplat.radialSorting = true;

            const eventHandler = app.systems.gsplat;

            // idle timer: force continuous rendering until 4s of inactivity
            let idleTime = 0;
            this.forceRenderNextFrame = true;

            app.on('update', (dt: number) => {
                idleTime += dt;
                this.forceRenderNextFrame = idleTime < 4;
            });

            // Wake the render loop the INSTANT a finger lands. With
            // autoRender off, after the 4 s idle window nothing renders, and
            // iOS Safari then throttles/parks rAF hard — and here is the trap:
            // the engine only ever schedules the NEXT rAF from *inside* its own
            // tick (app.tick calls requestAnimationFrame at the top). Once the
            // browser stops firing the pending rAF, no tick runs, so nothing
            // re-schedules it — and setting `renderNextFrame = true` is then a
            // pure no-op (proven: after 5 s idle the flag was true yet zero
            // frames rendered; a single app.tick() produced exactly one). So
            // the old wake armed a flag no running loop was left to read, and
            // the visible response waited for the browser to resume rAF on its
            // own — the multi-second lag on e.g. the dollhouse exit.
            //
            // Fix: drive ONE frame synchronously on contact. That restarts the
            // stalled loop, renders (which resumes the browser's rAF cadence
            // now that the page paints again), and re-schedules the next frame
            // from within the tick — so the transition begins on the touch, not
            // seconds later. Guarded against re-entrancy; only fires on real
            // discrete input, so the synchronous frame is cheap and rare.
            const engine = app as unknown as { tick: () => void; _inFrameUpdate?: boolean };
            const kick = () => {
                idleTime = 0;
                this.forceRenderNextFrame = true;
                app.renderNextFrame = true;
                if (!engine._inFrameUpdate) engine.tick();
            };
            window.addEventListener('pointerdown', kick, { capture: true, passive: true });
            window.addEventListener('touchstart', kick, { capture: true, passive: true });

            // A discrete action (button tap, mode switch) that isn't a raw
            // pointer/touch — same treatment, so it can't wait on a parked rAF.
            events.on('inputEvent', (type: string) => {
                if (type !== 'interact') kick();
            });

            // While LOD chunks stream/decode, frame times spike for reasons
            // that are NOT the GPU's fault — the tier monitor below must not
            // count them. Hold measurement during loading + a short tail
            // (decode/upload lags the download signal).
            let streamingHoldUntilMs = 0;

            eventHandler.on('frame:ready', (_camera: CameraComponent, _layer: Layer, ready: boolean, loading: number) => {
                if (loading > 0 || !ready) {
                    idleTime = 0;
                    streamingHoldUntilMs = performance.now() + 1500;
                }
            });

            let current = 0;
            let watermark = 1;
            const readyHandler = (camera: CameraComponent, layer: Layer, ready: boolean, loading: number) => {
                if (ready && loading === 0) {
                    // scene is done loading
                    eventHandler.off('frame:ready', readyHandler);

                    state.readyToRender = true;

                    // Wire the quality ramp (mode changes + runtime tier
                    // demotion + hero-still refinement) and run it once.
                    const startQualityRamp = () => {
                        events.on('performanceMode:changed', applyPerfSettings);
                        events.on('deviceTier:changed', applyPerfSettings);
                        events.on('heroStill:changed', applyPerfSettings);
                        events.on('positionStable:changed', applyPerfSettings);
                        applyPerfSettings();
                    };
                    if (mobile) {
                        // The reveal moment is where the full-detail streaming
                        // wave used to start: applyPerfSettings drops the
                        // load-time lowest-LOD clamp, and the decode/upload
                        // burst then collides with the entrance glide under
                        // the fading splash — on A14/A15-class phones exactly
                        // that handover stuttered. Hold the wave until the
                        // arrival settles (first hero-still = camera stood
                        // still briefly), with a hard cap so a visitor who
                        // immediately walks off never lingers on the coarse
                        // LOD. Motion hides the coarse stage; the sharp
                        // upgrade lands on a still image, where it reads as
                        // intended.
                        let ramped = false;
                        const rampOnce = () => {
                            if (ramped) return;
                            ramped = true;
                            startQualityRamp();
                        };
                        events.once('heroStill:changed', rampOnce);
                        setTimeout(rampOnce, 2500);
                    } else {
                        startQualityRamp();
                    }

                    // Runtime tier DEMOTION — the safety net for devices the
                    // static heuristic can't know (Android wildcards, old
                    // Pro-Max models, thermal collapse): fps-EMA measured only
                    // while frames render continuously; if it can't hold the
                    // tier's floor for 3 consecutive seconds, drop one tier
                    // (high -> mid -> low). Never promotes: warm-up is slow
                    // and invisible to the web, oscillation would be worse.
                    //
                    // Measurement blackouts (jank that is NOT the GPU's fault
                    // must never demote): the first seconds after load (shader
                    // warm-up, initial LOD upgrades), any chunk-streaming
                    // window (+tail, see streamingHoldUntilMs), the staging
                    // prewarm flight, and 10s after a demotion (the resize/
                    // rebuffer it causes would cascade). EMA restarts fresh
                    // after each demotion.
                    {
                        // Desktop reacts FAST (a laggy Mac should settle in a
                        // few seconds, not half a minute): shorter warm-up,
                        // less time under floor before demoting, shorter
                        // cooldown, and a snappier fps EMA. Mobile stays gentle
                        // (heat/battery, streaming jank) to avoid oscillation.
                        const warmupUntilMs = performance.now() + (mobile ? 5000 : 2200);
                        const belowLimit = mobile ? 3 : 1.2;   // s under floor before a demote
                        const cooldownS = mobile ? 10 : 4;     // s between demotes
                        const emaAlpha = mobile ? 0.08 : 0.15;
                        let fpsEma = 60;
                        let belowFor = 0;
                        let lastDemote = 0;
                        // Desktop targets a higher floor than mobile (a desktop
                        // GPU that can't hold ~45fps should shed load); mobile
                        // trades fps for heat/battery so its floor is lower.
                        // 'low' is the bottom rung (floor 0 = never demotes on).
                        const floorFor = (t: 'low' | 'mid' | 'high') => {
                            if (t === 'low') return 0;
                            if (mobile) return t === 'high' ? 30 : 22;
                            return t === 'high' ? 48 : 33;
                        };
                        app.on('update', (dt: number) => {
                            if (!this.forceRenderNextFrame || dt <= 0) return;
                            const nowMs = performance.now();
                            // Never demote on a hero still: a heavier STATIC frame
                            // doesn't stutter, and the extra load is intentional
                            // and momentary — measuring it would wrongly downgrade
                            // the moving profile.
                            if (nowMs < warmupUntilMs || nowMs < streamingHoldUntilMs || state.prewarming || state.heroStill) {
                                belowFor = 0;
                                return;
                            }
                            fpsEma += (1 / dt - fpsEma) * emaAlpha;
                            const floor = floorFor(state.deviceTier);
                            belowFor = (floor > 0 && fpsEma < floor) ? belowFor + dt : 0;
                            if (belowFor > belowLimit && nowMs / 1000 - lastDemote > cooldownS) {
                                lastDemote = nowMs / 1000;
                                belowFor = 0;
                                fpsEma = 60;
                                state.deviceTier = state.deviceTier === 'high' ? 'mid' : 'low';
                                if (config.devtools) {
                                    console.log('[perf] fps could not hold the profile - demoted tier to', state.deviceTier);
                                }
                            }
                        });
                    }

                    // debug colorize lods
                    gsplat.debug = config.colorize ? GSPLAT_DEBUG_LOD : GSPLAT_DEBUG_NONE;
                    gsplat.renderer = rendererTable[renderer];

                    // wait for the first valid frame to complete rendering
                    app.once('frameend', () => {
                        events.fire('firstFrame');

                        // emit first frame event on window
                        window.firstFrame?.();
                    });
                }

                // update loading status
                if (loading !== current) {
                    watermark = Math.max(watermark, loading);
                    current = watermark - loading;
                    state.progress = Math.trunc(current / watermark * 100);
                }
            };

            eventHandler.on('frame:ready', readyHandler);
        }).catch((err) => {
            // scene load or setup failed — surface the user-facing error card
            // (index.html listens for this) instead of a stuck loading bar
            console.error(err);
            window.dispatchEvent(new CustomEvent('sse:error', { detail: err }));
        });
    }

    // configure camera based on application mode and post process settings
    configureCamera(settings: ExperienceSettings) {
        const { global } = this;
        const { app, config, camera } = global;
        const { postEffectSettings } = settings;
        const { background } = settings;

        // effective constrained-device flag (see the constructor): config.mobile
        // includes the iPadOS probe, platform.mobile is the fallback.
        const mobile = config.mobile ?? platform.mobile;
        const fillRateLimited = !mobile && (config.fillrate ?? false);

        // hpr override takes precedence over settings.highPrecisionRendering
        const highPrecisionRendering = config.hpr ?? settings.highPrecisionRendering;

        // Mobile skips the post-fx camera frame entirely: the extra full-screen
        // pass costs real fill rate on phones (the primary bottleneck), and the
        // sharpness gain is invisible at mobile pixel sizes. Verified on-device
        // 2026-07-02: ?nofx was the smoothest variant on iPhone. Fill-rate-
        // limited desktops (Macs) skip it for the same reason — their TBDR
        // GPUs pay the same full-screen-pass cost the phones do.
        const postFxRequested = !config.nofx && !mobile && !fillRateLimited &&
            (anyPostEffectEnabled(postEffectSettings) || highPrecisionRendering);

        const enableCameraFrame = !app.xr.active && postFxRequested;

        if (enableCameraFrame) {
            // create instance
            if (!this.cameraFrame) {
                this.cameraFrame = new CameraFrame(app, camera.camera);
            }

            const { cameraFrame } = this;
            cameraFrame.enabled = true;
            cameraFrame.rendering.toneMapping = tonemapTable[settings.tonemapping];
            cameraFrame.rendering.renderFormats = highPrecisionRendering ? [PIXELFORMAT_RGBA16F, PIXELFORMAT_RGBA32F] : [];
            applyPostEffectSettings(cameraFrame, postEffectSettings);
            cameraFrame.update();

            // force gsplat shader to write gamma-space colors
            ShaderChunks.get(app.graphicsDevice, 'glsl').set('gsplatOutputVS', gammaChunkGlsl);
            ShaderChunks.get(app.graphicsDevice, 'wgsl').set('gsplatOutputVS', gammaChunkWgsl);

            // force skybox shader to write gamma-space colors (inline pow replaces the
            // gammaCorrectOutput call which is a no-op under CameraFrame's GAMMA_NONE)
            ShaderChunks.get(app.graphicsDevice, 'glsl').set('skyboxPS',
                patchChunk(
                    this.origChunks.glsl.skyboxPS,
                    'gammaCorrectOutput(toneMap(processEnvironment(linear)))',
                    'pow(toneMap(processEnvironment(linear)) + 0.0000001, vec3(1.0 / 2.2))',
                    'glsl skyboxPS gamma override'
                )
            );
            ShaderChunks.get(app.graphicsDevice, 'wgsl').set('skyboxPS',
                patchChunk(
                    this.origChunks.wgsl.skyboxPS,
                    'gammaCorrectOutput(toneMap(processEnvironment(linear)))',
                    'pow(toneMap(processEnvironment(linear)) + 0.0000001, vec3f(1.0 / 2.2))',
                    'wgsl skyboxPS gamma override'
                )
            );

            // ensure the final compose blit doesn't perform linear->gamma conversion.
            RenderTarget.prototype.isColorBufferSrgb = function (index) {
                return this === app.graphicsDevice.backBuffer ? true : origIsColorBufferSrgb.call(this, index);
            };

            camera.camera.clearColor = new Color(background.color);
        } else {
            // no post effects needed, destroy camera frame if it exists
            if (this.cameraFrame) {
                this.cameraFrame.destroy();
                this.cameraFrame = null;
            }

            // restore shader chunks to engine defaults
            ShaderChunks.get(app.graphicsDevice, 'glsl').set('gsplatOutputVS', this.origChunks.glsl.gsplatOutputVS);
            ShaderChunks.get(app.graphicsDevice, 'wgsl').set('gsplatOutputVS', this.origChunks.wgsl.gsplatOutputVS);
            ShaderChunks.get(app.graphicsDevice, 'glsl').set('skyboxPS', this.origChunks.glsl.skyboxPS);
            ShaderChunks.get(app.graphicsDevice, 'wgsl').set('skyboxPS', this.origChunks.wgsl.skyboxPS);

            // restore original isColorBufferSrgb behavior
            RenderTarget.prototype.isColorBufferSrgb = origIsColorBufferSrgb;

            if (!app.xr.active) {
                camera.camera.toneMapping = tonemapTable[settings.tonemapping];
                camera.camera.clearColor = new Color(background.color);
            }
        }

        // Mesh overlay bakes its vertex colors based on the current gamma
        // path; reapply when CameraFrame is created/destroyed (e.g. on XR
        // start/end) so the overlay tracks the new path.
        this.meshOverlay?.setCameraFrameEnabled(!!this.cameraFrame);
    }
}

export { Viewer };
