import {
    type BoundingBox,
    Vec3
} from 'playcanvas';

import { AerialController } from './cameras/aerial-controller';
import { AnimController } from './cameras/anim-controller';
import { Camera, type CameraFrame, type CameraController } from './cameras/camera';
import { FlyController } from './cameras/fly-controller';
import { FlySource } from './cameras/fly-source';
import { IdleLook } from './cameras/idle-look';
import { OrbitController } from './cameras/orbit-controller';
import type { TargetSource } from './cameras/target-navigation';
import { WalkController } from './cameras/walk-controller';
import { WalkSource } from './cameras/walk-source';
import type { Collision } from './collision';
import { easeOut } from './core/math';
import { Annotation } from './settings';
import type { SharedView } from './share';
import { CameraMode, Global } from './types';

const tmpCamera = new Camera();
const tmpFocus = new Vec3();

// single-char camera mode codes used by the `?view=` share links
const shareModeByChar: Record<string, CameraMode> = {
    w: 'walk', f: 'fly', o: 'orbit', a: 'aerial'
};
const shareCharByMode: Partial<Record<CameraMode, string>> = {
    walk: 'w', fly: 'f', orbit: 'o', aerial: 'a'
};

// Walk mode is only enabled when the scene's horizontal footprint is large
// enough to walk around in. Vertical extent (Y) is irrelevant — a tall but
// narrow scene isn't walkable. Both X and Z ranges must exceed this
// minimum (in metres); below it walk mode is hidden and the viewer falls
// back to fly as the default first-person mode.
const WALK_MIN_HORIZONTAL_RANGE = 5;

const isWalkAllowed = (bbox: BoundingBox, collision: Collision | null): boolean => {
    const { x, z } = bbox.halfExtents;
    return !!collision && x * 2 >= WALK_MIN_HORIZONTAL_RANGE && z * 2 >= WALK_MIN_HORIZONTAL_RANGE;
};

const createCamera = (position: Vec3, target: Vec3, fov: number) => {
    const result = new Camera();
    result.look(position, target);
    result.fov = fov;
    return result;
};

const createFrameCamera = (bbox: BoundingBox, fov: number) => {
    const sceneSize = bbox.halfExtents.length();
    const distance = sceneSize / Math.sin(fov / 180 * Math.PI * 0.5);
    return createCamera(
        new Vec3(2, 1, 2).normalize().mulScalar(distance).add(bbox.center),
        bbox.center,
        fov
    );
};

class CameraManager {
    update: (deltaTime: number, cameraFrame: CameraFrame) => void;

    // Re-seed the active controller from the current camera pose and
    // cancel any in-progress transition lerp. Use after externally
    // mutating `camera` and/or `state.cameraMode` to make the change
    // visible instantly.
    snap: () => void;

    // holds the camera state
    camera = new Camera();

    constructor(global: Global, bbox: BoundingBox, collision: Collision | null = null) {
        const { events, settings, state } = global;

        const walkAllowed = isWalkAllowed(bbox, collision);

        const camera0 = settings.cameras[0]?.initial;
        const defaultFov = camera0?.fov ?? 75;
        const frameCamera = createFrameCamera(bbox, defaultFov);
        const resetCamera = camera0 ?
            createCamera(new Vec3(camera0.position), new Vec3(camera0.target), camera0.fov) :
            frameCamera;

        // Curated "Raum von oben" bird's-eye viewpoints (Option A) the visitor can
        // page through with the on-screen arrows. Centred on the scene; the
        // heights/angles are tuned for this scan and are the per-scene values we'd
        // later move into settings.json for other scenes.
        const cx = bbox.center.x;
        const cz = bbox.center.z;
        // Height 3.6 sits just under the ceiling (the scan fogs out above ~3.7),
        // so the drone is at the highest the room allows without clipping into it.
        const aerialViews = [
            createCamera(new Vec3(cx, 3.6, cz - 3.9), new Vec3(cx, 0.2, cz + 1.6), 95),  // wide, from the front
            createCamera(new Vec3(cx, 3.6, cz + 3.9), new Vec3(cx, 0.2, cz - 1.6), 95),  // wide, from the back
            // middle: dead-centre of the ceiling, angled down to face the LONG
            // wall (look across +x) so the long side reads broad/wide, not deep.
            createCamera(new Vec3(cx, 3.6, cz), new Vec3(cx + 1.6, 0.1, cz), 92)
        ];
        let aerialIndex = 0;

        const getAnimTrack = (initial: Camera, isObjectExperience: boolean) => {
            const { animTracks } = settings;

            // Only run a camera animation track when one is explicitly authored
            // in the settings. It powers two experiences: the autoplay start
            // (startMode 'animTrack') and the on-demand guided tour ("Rundgang")
            // started from the control dome. We deliberately drop the automatic
            // rotate/figure-8 fallbacks: for our clean viewer the idle motion is
            // the organic look-around handled in fly mode, not a mechanical
            // orbit.
            if (animTracks?.length > 0) {
                return animTracks[0];
            }
            return null;
        };

        // object experience starts outside the bounding box
        const isObjectExperience = !bbox.containsPoint(resetCamera.position);
        const animTrack = getAnimTrack(resetCamera, isObjectExperience);

        const controllers = {
            orbit: new OrbitController(),
            fly: new FlyController(),
            walk: new WalkController(),
            aerial: new AerialController(),
            anim: animTrack ? new AnimController(animTrack) : null
        };

        controllers.orbit.fov = resetCamera.fov;
        controllers.fly.fov = resetCamera.fov;
        controllers.fly.collision = collision;
        controllers.walk.collision = collision;

        const walkSource = new WalkSource();
        const flySource = new FlySource();
        const sourcesByMode: Partial<Record<CameraMode, TargetSource>> = {
            walk: walkSource,
            fly: flySource
        };
        walkSource.onComplete = flySource.onComplete = () => {
            events.fire('navigateComplete');
        };

        const getController = (cameraMode: CameraMode): CameraController => {
            return controllers[cameraMode] as CameraController;
        };

        // set the global animation flag
        state.hasAnimation = !!controllers.anim;
        state.animationDuration = controllers.anim ? controllers.anim.animState.cursor.duration : 0;

        // initialize camera mode and initial camera position. A track only
        // autoplays when the scene is authored to start with it (startMode
        // 'animTrack'); an on-demand tour track must not hijack the start pose.
        const autoplayAnim = state.hasAnimation && settings.startMode === 'animTrack';
        state.cameraMode = autoplayAnim ? 'anim' : (isObjectExperience ? 'orbit' : (walkAllowed ? 'walk' : 'fly'));
        this.camera.copy(resetCamera);

        const target = new Camera(this.camera);             // the active controller updates this
        const from = new Camera(this.camera);               // stores the previous camera state during transition
        const defaultMode: CameraMode = isObjectExperience ? 'orbit' : (walkAllowed ? 'walk' : 'fly');
        let fromMode: CameraMode = defaultMode;

        // tracks the mode to restore when exiting walk
        let preWalkMode: CameraMode = isObjectExperience ? 'orbit' : 'fly';

        // bird's-eye (aerial) toggle state: the mode + exact pose to glide back to
        let preAerialMode: CameraMode = defaultMode;
        const preAerialCamera = new Camera(this.camera);

        // enter the initial controller
        getController(state.cameraMode).onEnter(this.camera);

        // Capture the curated starting spawn ONCE as the stable "home" pose.
        // The walk controller's per-entry spawn is overwritten on every walk
        // re-entry — including the involuntary one when leaving drone mode, which
        // briefly runs walk.onEnter from the ceiling and stores a bad spawn. The
        // Home button must restore this fixed start pose, not that volatile one.
        const homeCamera = new Camera(this.camera);
        controllers.walk.resetToSpawn(homeCamera);

        // transition state
        const transitionSpeed = 1.0;
        let transitionTimer = 1;
        let clearOrbitTargetOnTransitionEnd = false;

        // Set when a guided tour starts from the top ('tour:start'), consumed
        // by the single 'tour:complete' that started tour may fire. Scrubbing
        // ('scrubAnim') enters anim mode WITHOUT resetting the cursor, so a
        // scrub-to-end — or a pointerup parking the cursor at the end again —
        // must not (re)fire 'tour:complete'.
        let tourStarted = false;

        // start a new camera transition from the current pose
        const startTransition = () => {
            from.copy(this.camera);
            transitionTimer = 0;
        };

        this.snap = () => {
            getController(state.cameraMode).onEnter(this.camera);
            target.copy(this.camera);
            transitionTimer = 1;
            global.app.renderNextFrame = true;
        };

        // Tour playback pacing. The authored track is deliberately smooth and
        // slow (trailer heritage) — the in-viewer Rundgang plays it at a
        // brisker base speed, and eases down into slow-motion while a fly-by
        // bubble is up (annotations.ts flips state.tourRevealActive) so the
        // text is comfortably readable, then eases back. Exponentially
        // smoothed so the speed changes never jerk. Both speeds are relative
        // to the authored track time and overridable per property via
        // settings.tour { speed, revealSpeed }.
        const tourCfg = global.settings.tour;
        const clampSpeed = (v: unknown, lo: number, hi: number, dflt: number) => {
            return (typeof v === 'number' && v >= lo && v <= hi) ? v : dflt;
        };
        const TOUR_SPEED = clampSpeed(tourCfg?.speed, 0.25, 3, 1.5);
        const TOUR_REVEAL_SPEED = clampSpeed(tourCfg?.revealSpeed, 0.05, 1, 0.35);
        let tourSlowFactor = TOUR_SPEED;

        // application update
        this.update = (deltaTime: number, frame: CameraFrame) => {

            const slowTarget = (state.cameraMode === 'anim' && state.tourRevealActive) ? TOUR_REVEAL_SPEED : TOUR_SPEED;
            tourSlowFactor += (slowTarget - tourSlowFactor) * Math.min(1, deltaTime * 2.5);

            // use dt of 0 if animation is paused; slow the track while a
            // fly-by bubble is being read
            const dt = state.cameraMode === 'anim' ?
                (state.animationPaused ? 0 : deltaTime * tourSlowFactor) :
                deltaTime;

            // update transition timer
            const prevTransitionTimer = transitionTimer;
            transitionTimer = Math.min(1, transitionTimer + deltaTime * transitionSpeed);

            const controller = getController(state.cameraMode);

            sourcesByMode[state.cameraMode]?.update(dt, this.camera, frame);

            // The gaze offset is a per-frame, walk-only render detail. Clear it
            // before the controller runs so non-walk controllers (which never
            // set it) can't show a stale scan, and so the walk controller starts
            // from a clean slate each frame.
            target.gazeYaw = 0;
            target.gazePitch = 0;

            // Reset the idle-wander flag each frame; the active controller's
            // idle-look (fly mode only) re-sets it if it's actually wandering.
            IdleLook.wandering = false;

            controller.update(dt, frame, target);

            if (transitionTimer < 1) {
                // lerp away from previous camera during transition
                this.camera.lerp(from, target, easeOut(transitionTimer));
            } else {
                this.camera.copy(target);
            }

            // update animation timeline
            if (state.cameraMode === 'anim') {
                const { cursor } = controllers.anim.animState;
                state.animationTime = cursor.value;

                // A non-looping track (the guided Rundgang) has reached its
                // end: hand control back to the mode the visitor came from —
                // the same exit path 'cancel'/'interrupt' use.
                if (cursor.loopMode === 'none' && cursor.duration > 0 && cursor.value >= cursor.duration) {
                    state.cameraMode = fromMode;
                    // played through to the end (interrupt/cancel exits don't
                    // come this way) — signal it, e.g. for analytics; at most
                    // once per started tour (see tourStarted)
                    if (tourStarted) {
                        tourStarted = false;
                        events.fire('tour:complete');
                    }
                }
            }

            if (clearOrbitTargetOnTransitionEnd && prevTransitionTimer < 1 && transitionTimer === 1) {
                clearOrbitTargetOnTransitionEnd = false;
                events.fire('orbitTarget:clear');
            }

            // Signal when an aerial (drone) glide settles, so callers can grab a
            // clean settled frame (used by virtual staging). Carries the index of
            // the bird's-eye viewpoint we arrived at.
            if (state.cameraMode === 'aerial' && prevTransitionTimer < 1 && transitionTimer === 1) {
                events.fire('aerialArrived', aerialIndex);
            }
        };

        // handle input events
        events.on('inputEvent', (eventName, arg) => {
            switch (eventName) {
                case 'frame':
                    events.fire('orbitTarget:clear');
                    state.cameraMode = 'orbit';
                    controllers.orbit.goto(frameCamera);
                    startTransition();
                    break;
                case 'aerial':
                    if (state.cameraMode === 'aerial') {
                        // exit: glide back down to exactly where we left off
                        state.cameraMode = preAerialMode;
                        (controllers[preAerialMode] as { goto?: (c: Camera) => void } | null)?.goto?.(preAerialCamera);
                        startTransition();
                    } else {
                        // enter: remember the spot, then rise to the first bird's-eye view
                        preAerialMode = state.cameraMode;
                        preAerialCamera.copy(this.camera);
                        events.fire('orbitTarget:clear');
                        sourcesByMode[state.cameraMode]?.cancel();
                        aerialIndex = 0;
                        state.cameraMode = 'aerial';
                        controllers.aerial.goto(aerialViews[aerialIndex]);
                        startTransition();
                    }
                    break;
                case 'aerialNext':
                case 'aerialPrev':
                    // page between the curated bird's-eye viewpoints (aerial mode only)
                    if (state.cameraMode === 'aerial') {
                        const n = aerialViews.length;
                        aerialIndex = (aerialIndex + (eventName === 'aerialNext' ? 1 : -1) + n) % n;
                        controllers.aerial.goto(aerialViews[aerialIndex]);
                        startTransition();
                    }
                    break;
                case 'aerialGoto': {
                    // Fly to a SPECIFIC bird's-eye viewpoint from any mode and glide
                    // there. Used by virtual staging, which always frames the room
                    // from one fixed drone angle. Fires 'aerialArrived' when settled.
                    const n = aerialViews.length;
                    const idx = Math.max(0, Math.min(n - 1, Number(arg) | 0));
                    if (state.cameraMode !== 'aerial') {
                        preAerialMode = state.cameraMode;
                        preAerialCamera.copy(this.camera);
                        events.fire('orbitTarget:clear');
                        sourcesByMode[state.cameraMode]?.cancel();
                        state.cameraMode = 'aerial';
                    }
                    aerialIndex = idx;
                    controllers.aerial.goto(aerialViews[aerialIndex]);
                    startTransition();
                    break;
                }
                case 'reset':
                    if (state.cameraMode === 'walk') {
                        walkSource.cancel();
                        events.fire('navTarget:clear');
                        startTransition();
                        // Always return to the fixed curated start, never the
                        // volatile per-entry spawn (see homeCamera above).
                        controllers.walk.goto(homeCamera);
                    } else if (state.cameraMode === 'fly') {
                        flySource.cancel();
                        startTransition();
                        controllers.fly.resetToSpawn(target);
                    } else if (defaultMode === 'orbit') {
                        events.fire('orbitTarget:clear');
                        state.cameraMode = 'orbit';
                        controllers.orbit.goto(resetCamera);
                        startTransition();
                    } else {
                        // From orbit/aerial/anim (including a running Rundgang),
                        // home returns to the scene's default first-person mode
                        // at the curated start pose — on touch there are no mode
                        // buttons, so orbit must never become a trap.
                        sourcesByMode[state.cameraMode]?.cancel();
                        events.fire('orbitTarget:clear');
                        events.fire('navTarget:clear');
                        state.cameraMode = defaultMode;
                        (controllers[defaultMode] as { goto?: (c: Camera) => void } | null)?.goto?.(homeCamera);
                        startTransition();
                    }
                    break;
                case 'tour':
                    // guided-tour toggle ("Rundgang"): start track 0 from the
                    // top, or stop and hand back to the mode the visitor came
                    // from — the same exit path 'cancel'/'interrupt' use.
                    if (state.moveLocked) break;    // don't hijack while the tutorial gate is up
                    if (state.hasAnimation) {
                        if (state.cameraMode === 'anim') {
                            state.cameraMode = fromMode;
                        } else {
                            sourcesByMode[state.cameraMode]?.cancel();
                            events.fire('navTarget:clear');
                            controllers.anim.animState.cursor.value = 0;
                            controllers.anim.animState.update(0);
                            state.cameraMode = 'anim';
                            state.animationPaused = false;
                            // the guided tour started from the top — signal it,
                            // e.g. for analytics
                            tourStarted = true;
                            events.fire('tour:start');
                        }
                    }
                    break;
                case 'playPause':
                    if (state.hasAnimation) {
                        if (state.cameraMode === 'anim') {
                            state.animationPaused = !state.animationPaused;
                        } else {
                            state.cameraMode = 'anim';
                            state.animationPaused = false;
                        }
                    }
                    break;
                case 'requestFirstPerson':
                    state.cameraMode = 'fly';
                    break;
                case 'toggleWalk':
                    if (walkAllowed) {
                        if (state.cameraMode === 'walk') {
                            state.cameraMode = preWalkMode;
                        } else {
                            preWalkMode = state.cameraMode;
                            state.cameraMode = 'walk';
                        }
                    }
                    break;
                case 'exitWalk':
                    if (state.cameraMode === 'walk') {
                        state.cameraMode = preWalkMode;
                    }
                    break;
                case 'cancel':
                    if (state.cameraMode === 'anim') {
                        state.cameraMode = fromMode;
                    }
                    break;
                case 'interrupt':
                    if (state.cameraMode === 'anim') {
                        state.cameraMode = fromMode;
                    }
                    break;
            }
        });

        // Fly the camera to a curated point of interest (e.g. "the window"),
        // landing in walk mode so the visitor can carry on naturally afterwards.
        // Used by the concierge: when an answer is about a locatable object, it
        // focuses it. `poi.camera` is { position:[x,y,z], target:[x,y,z], fov }.
        events.on('focusPoi', (poi: { position: number[]; target: number[]; fov: number }) => {
            if (state.moveLocked) return;       // don't hijack while the tutorial gate is up
            const poiCam = createCamera(new Vec3(poi.position), new Vec3(poi.target), poi.fov);
            if (state.cameraMode !== 'walk') {
                sourcesByMode[state.cameraMode]?.cancel();
                state.cameraMode = 'walk';      // back to first person; fires cameraMode:changed
            }
            walkSource.cancel();
            events.fire('navTarget:clear');
            controllers.walk.goto(poiCam);
            startTransition();
        });

        // ---- Share / deep-link viewpoints (see share.ts) -------------------
        // 'view:capture' fills the passed holder with the current pose so
        // share.ts can build a `?view=` link synchronously.
        events.on('view:capture', (out: { view?: SharedView }) => {
            const cam = this.camera;
            cam.calcFocusPoint(tmpFocus);
            out.view = {
                position: [cam.position.x, cam.position.y, cam.position.z],
                target: [tmpFocus.x, tmpFocus.y, tmpFocus.z],
                fov: cam.fov,
                mode: shareCharByMode[state.cameraMode]
            };
        });

        // 'view:apply' restores a deep-linked pose once the scene is ready.
        // Mirrors the debug panel's restoreCameraState: set the pose, switch
        // the mode (fires cameraMode:changed → controller onExit/onEnter),
        // then snap() to re-seed the controller and cancel the transition
        // lerp so the visitor lands exactly on the shared view.
        events.on('view:apply', (view: SharedView) => {
            let mode = shareModeByChar[view.mode ?? ''] ?? state.cameraMode;
            if ((mode === 'walk' && !walkAllowed) || mode === 'anim') {
                mode = defaultMode;
            }
            sourcesByMode[state.cameraMode]?.cancel();
            events.fire('orbitTarget:clear');
            events.fire('navTarget:clear');
            this.camera.copy(createCamera(new Vec3(view.position), new Vec3(view.target), view.fov));
            if (mode === 'orbit') {
                // snap() re-enters via onEnter, which (unlike goto) keeps the
                // controller's stored fov — adopt the shared one explicitly
                controllers.orbit.fov = view.fov;
            }
            if (state.cameraMode !== mode) {
                state.cameraMode = mode;
            }
            this.snap();
        });

        // Authoring helper: log the current camera as a ready-to-paste POI
        // viewpoint. Frame a spot in the viewer, then call captureView() in the
        // browser console and paste the result into settings.json `pois`.
        // Only exposed for the authoring/tooling entry points (?debug / ?scout
        // / ?record), never in the visitor path.
        if (global.config.devtools) {
            (window as unknown as { captureView: () => unknown }).captureView = () => {
                const p = global.camera.getPosition();
                const f = global.camera.forward;
                const r = (n: number) => Math.round(n * 1000) / 1000;
                const poi = {
                    position: [r(p.x), r(p.y), r(p.z)],
                    target: [r(p.x + f.x * 2), r(p.y + f.y * 2), r(p.z + f.z * 2)],
                    fov: Math.round(this.camera.fov)
                };
                console.log(`captureView →\n${JSON.stringify(poi)}`);
                return poi;
            };
        }

        // handle camera mode switching
        events.on('cameraMode:changed', (value: CameraMode, prev: CameraMode) => {
            sourcesByMode[prev]?.cancel();

            // snapshot the current pose before any controller mutation
            startTransition();

            target.copy(this.camera);
            fromMode = prev;

            // exit the old controller
            const prevController = getController(prev);
            prevController.onExit(this.camera);

            // enter new controller
            const newController = getController(value);
            newController.onEnter(this.camera);
        });

        // handle user scrubbing the animation timeline
        events.on('scrubAnim', (time) => {
            // switch to animation camera if we're not already there
            state.cameraMode = 'anim';

            // set time
            controllers.anim.animState.cursor.value = time;
        });

        // handle user picking in the scene
        events.on('pick', (position: Vec3) => {
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';

            // construct camera
            tmpCamera.copy(this.camera);
            tmpCamera.look(this.camera.position, position);

            controllers.orbit.goto(tmpCamera);
            startTransition();
            clearOrbitTargetOnTransitionEnd = true;
        });

        // Annotation taps frame the hotspot in orbit mode. Remember which MODE
        // the visitor came from and hand back when the tooltip closes — on
        // touch there are no mode buttons, so orbit must never become a trap
        // (mirrors the aerial enter/exit pattern).
        let preAnnotationMode: CameraMode | null = null;

        events.on('annotation.activate', (annotation: Annotation) => {
            events.fire('orbitTarget:clear');

            if (state.cameraMode !== 'orbit') {
                preAnnotationMode = state.cameraMode;
                sourcesByMode[state.cameraMode]?.cancel();
                events.fire('navTarget:clear');
            }

            // switch to orbit camera on pick
            state.cameraMode = 'orbit';

            const { initial } = annotation.camera;

            // construct camera
            tmpCamera.fov = initial.fov;
            tmpCamera.look(
                new Vec3(initial.position),
                new Vec3(initial.target)
            );

            controllers.orbit.goto(tmpCamera);
            startTransition();
        });

        // Tooltip closed: hand control back WHERE THE VISITOR IS, not back
        // across the flat to the pre-tour pose. Setting the mode makes the
        // controller's onEnter spawn from the CURRENT camera — walk finds the
        // nearest valid floor spot via findCylinderSpawn and keeps the viewing
        // direction — so leaving a highlight simply drops you into walking
        // right there. (The old restore lerped straight-line to a stale spot,
        // cutting through walls after a multi-highlight browse: felt broken.)
        events.on('annotation.deactivate', () => {
            if (preAnnotationMode !== null && state.cameraMode === 'orbit') {
                state.cameraMode = preAnnotationMode;
                startTransition();
            }
            preAnnotationMode = null;
        });

        // tap-to-navigate: start auto-driving the active mode toward a picked position
        events.on('navigateTo', (position: Vec3, normal: Vec3, speedMul = 1) => {
            // onboarding gate: movement is blocked until the visitor has looked around
            if (state.moveLocked) {
                return;
            }
            const source = sourcesByMode[state.cameraMode];
            if (source) {
                source.navigateTo(position, speedMul);
                events.fire('navTarget:set', position, normal);
            }
        });

        // cancel any active auto-navigation in the current mode
        events.on('navigateCancel', () => {
            sourcesByMode[state.cameraMode]?.cancel();
            events.fire('navTarget:clear');
        });

        events.on('navigateComplete', () => {
            events.fire('navTarget:clear');
        });
    }
}

export { CameraManager, isWalkAllowed };
