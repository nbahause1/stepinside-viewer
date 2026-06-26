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
import { CameraMode, Global } from './types';

const tmpCamera = new Camera();

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
            // in the settings (startMode 'animTrack'). We deliberately drop the
            // automatic rotate/figure-8 fallbacks: for our clean viewer the idle
            // motion is the organic look-around handled in fly mode, not a
            // mechanical orbit. A real guided tour can still be added later via
            // settings.animTracks.
            if (animTracks?.length > 0 && settings.startMode === 'animTrack') {
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

        // initialize camera mode and initial camera position
        state.cameraMode = state.hasAnimation ? 'anim' : (isObjectExperience ? 'orbit' : (walkAllowed ? 'walk' : 'fly'));
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

        // application update
        this.update = (deltaTime: number, frame: CameraFrame) => {

            // use dt of 0 if animation is paused
            const dt = state.cameraMode === 'anim' && state.animationPaused ? 0 : deltaTime;

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
                state.animationTime = controllers.anim.animState.cursor.value;
            }

            if (clearOrbitTargetOnTransitionEnd && prevTransitionTimer < 1 && transitionTimer === 1) {
                clearOrbitTargetOnTransitionEnd = false;
                events.fire('orbitTarget:clear');
            }
        };

        // handle input events
        events.on('inputEvent', (eventName) => {
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
                    } else {
                        events.fire('orbitTarget:clear');
                        state.cameraMode = 'orbit';
                        controllers.orbit.goto(resetCamera);
                        startTransition();
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

        // Authoring helper: log the current camera as a ready-to-paste POI
        // viewpoint. Frame a spot in the viewer, then call captureView() in the
        // browser console and paste the result into settings.json `pois`.
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

        events.on('annotation.activate', (annotation: Annotation) => {
            events.fire('orbitTarget:clear');

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
