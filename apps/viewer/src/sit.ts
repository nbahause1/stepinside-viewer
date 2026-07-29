import { Vec3, math } from 'playcanvas';

import type { CameraManager } from './camera-manager';
import { IdleLook } from './cameras/idle-look';
import type { Collision } from './collision';
import type { Global } from './types';

// Hinsetzen ("Platz nehmen") — a first-person sit-down on authored seats.
//
// settings.seats[] = [{ position: [x,y,z], yaw }] where `position` is a point
// on the seat SURFACE (world, metres) and `yaw` is the direction the seated
// person faces (degrees, world; the viewer convention used by camera angles).
//
// UX: in walk mode, standing near a seat and roughly facing it, a small pill
// appears anchored to the seat. Tapping it plays a scripted first-person
// sit-down; seated, the visitor can freely look around (head turns, body
// stays), and any movement input stands back up and returns to walking.
//
// TECHNIQUE (deliberately invisible): for the animation the camera switches to
// the free FLY mode — the only mode that permits any height — and is driven as
// a per-frame puppet (pose write + snap(), the restoreCameraState pattern).
// The walk camera cannot leave standing eye height, and the fixed aerials are
// fixed; the free-fly rig is what makes a believable descent possible. The
// visitor never sees "fly mode": they see a body sitting down.
//
// The keyframes translate real sit-down biomechanics to the HEAD (= camera):
//   approach slows → gaze drops to the seat surface → body turns over one
//   shoulder → controlled descent (hips back+down, torso leans, head stays
//   comparatively level) → slight head lift just before contact → contact
//   with a soft overshoot → pelvis rights itself, small settle shuffles →
//   seated idle with breathing. Micro-asymmetries (weight on one leg, one
//   shoulder trailing) are baked into the curves so nothing reads robotic.

type Seat = { position: [number, number, number]; yaw: number };

type Phase = 'idle' | 'turn' | 'descend' | 'settle' | 'seated' | 'stand';

/** eye height above the SEAT surface when seated (m) */
const SEATED_EYE_ABOVE_SEAT = 0.62;

/** standing eye height above floor (matches the walk rig) */
const STANDING_EYE = 1.6;

/** where the body stands before sitting: this far in front of the seat edge */
const STAND_AHEAD = 0.42;

/** show the pill within this distance of the seat (m, XZ) */
const NEAR_DIST = 1.7;

const easeInOut = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => math.clamp(t, 0, 1);

const initSit = (global: Global, collision: Collision | null, getCM: () => CameraManager | null) => {
    const { app, events, settings, state } = global;
    const seats: Seat[] = Array.isArray((settings as any).seats)
        ? (settings as any).seats.filter((s: any) => Array.isArray(s?.position) && typeof s?.yaw === 'number')
        : [];
    if (!seats.length) return;

    // ---- UI: one pill, anchored to the nearest eligible seat ---------------
    const style = document.createElement('style');
    style.textContent = `
#sitPill { position: absolute; z-index: 30; transform: translate(-50%, -50%);
  padding: 9px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25);
  background: rgba(12,14,20,.78); color: #fff; font: 600 13px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  backdrop-filter: blur(10px); cursor: pointer; white-space: nowrap; user-select: none;
  transition: opacity .25s; opacity: 0; pointer-events: none; }
#sitPill.show { opacity: 1; pointer-events: auto; }
#sitPill:hover { background: rgba(30,34,44,.9); }
#sitPill.seatedMode { position: fixed; left: 50%; right: auto; top: auto; bottom: 96px;
  transform: translateX(-50%); }`;
    document.head.appendChild(style);
    const pill = document.createElement('button');
    pill.id = 'sitPill';
    pill.textContent = '🪑 Platz nehmen';
    document.getElementById('ui')?.appendChild(pill) ?? document.body.appendChild(pill);

    // ---- animation state ---------------------------------------------------
    let phase: Phase = 'idle';
    let t = 0;                          // seconds into the current phase
    let seat: Seat | null = null;
    let fromMode: 'walk' = 'walk';

    // poses (world)
    const startPos = new Vec3();        // pose when the sit began
    let startYaw = 0, startPitch = 0;
    const standPos = new Vec3();        // standing point in front of the seat
    const seatedPos = new Vec3();       // seated eye position
    let sitYaw = 0;                     // yaw of the seated person
    let turnDir = 1;                    // over which shoulder the body turns
    let breathe = 0;                    // breathing clock while seated

    const tmp = new Vec3();

    const cmCam = () => getCM()!.camera;

    const setPose = (p: Vec3, yaw: number, pitch: number) => {
        const cm = getCM();
        if (!cm) return;
        cm.camera.position.copy(p);
        cm.camera.angles.set(pitch, yaw, 0);
        cm.camera.distance = 0;        // first-person: eye IS the pose
        cm.snap();
    };

    // shortest signed angle a→b in degrees
    const yawDelta = (a: number, b: number) => {
        let d = (b - a) % 360;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        return d;
    };

    const beginSit = (s: Seat) => {
        const cm = getCM();
        if (!cm || state.cameraMode !== 'walk' || phase !== 'idle') return;
        seat = s;
        phase = 'turn';
        t = 0;
        state.measuring = true;         // blocks click-to-walk / tour / focusPoi hijacks
        IdleLook.suppressed = true;
        pill.classList.remove('show');

        const cam = cmCam();
        startPos.copy(cam.position);
        startYaw = cam.angles.y;
        startPitch = cam.angles.x;

        // seat frame
        const sp = new Vec3(s.position[0], s.position[1], s.position[2]);
        const rad = s.yaw * math.DEG_TO_RAD;
        // viewer yaw convention: angles.y=yaw with forward = (-sin, -cos)?? —
        // derived empirically from getYawDiffToTarget: yaw 0 faces -Z, positive
        // yaw turns toward -X. forward = (-sin(yaw), -cos(yaw)).
        const fx = -Math.sin(rad), fz = -Math.cos(rad);
        standPos.set(sp.x + fx * STAND_AHEAD, 0, sp.z + fz * STAND_AHEAD);
        // the walk rig is grounded RIGHT NOW — its eye height is the truth
        // (a fresh floor probe can hit the seat itself and mis-ground)
        standPos.y = startPos.y;
        seatedPos.set(sp.x, sp.y + SEATED_EYE_ABOVE_SEAT, sp.z);
        sitYaw = s.yaw;
        // turn over the shoulder that gives the shorter way
        turnDir = yawDelta(startYaw, sitYaw) >= 0 ? 1 : -1;
        state.cameraMode = 'fly';       // the invisible free rig
        setPose(startPos, startYaw, startPitch);
    };

    const finishToWalk = (standUp: boolean) => {
        phase = 'idle';
        seat = null;
        pill.classList.remove('seatedMode');
        pill.textContent = '🪑 Platz nehmen';
        state.measuring = false;
        IdleLook.suppressed = false;
        if (standUp) {
            state.cameraMode = fromMode; // walk re-grounds at the current XZ
            getCM()?.snap();
        }
    };

    app.on('update', (dt: number) => {
        const cm = getCM();
        if (!cm) return;

        // ---- proximity pill (walk mode only) -------------------------------
        if (phase === 'idle') {
            let best: Seat | null = null;
            let bestD = NEAR_DIST;
            if (state.cameraMode === 'walk' && !state.measuring && state.loaded) {
                const cam = cmCam();
                for (const s of seats) {
                    const d = Math.hypot(s.position[0] - cam.position.x, s.position[2] - cam.position.z);
                    if (d < bestD) { best = s; bestD = d; }
                }
            }
            if (best) {
                // project the seat point (slightly above the surface) to screen
                const camComp = (global.camera as any).camera;
                tmp.set(best.position[0], best.position[1] + 0.35, best.position[2]);
                const view = new Vec3();
                camComp.viewMatrix.transformPoint(tmp, view);
                if (view.z < 0) {
                    const s2 = camComp.worldToScreen(tmp);
                    pill.style.left = `${s2.x}px`;
                    pill.style.top = `${s2.y}px`;
                    pill.classList.add('show');
                    (pill as any).__seat = best;
                } else {
                    pill.classList.remove('show');
                }
            } else {
                pill.classList.remove('show');
            }
            return;
        }

        if (!seat) return;
        const sp = new Vec3(seat.position[0], seat.position[1], seat.position[2]);
        t += dt;

        switch (phase) {
            case 'turn': {
                // no approach: the visitor is already here. Turn over one
                // shoulder WHILE the last step settles the body in front of
                // the seat (position blends over during the turn); brief
                // weight shift onto one leg as a lateral sway.
                const D = 0.9;
                const k = easeInOut(clamp01(t / D));
                const yaw = startYaw + yawDelta(startYaw, sitYaw) * k;
                const pitch = startPitch + (-8 - startPitch) * k;
                const sway = Math.sin(k * Math.PI) * 0.045 * turnDir;
                const rad = sitYaw * math.DEG_TO_RAD;
                tmp.lerp(startPos, standPos, k);
                tmp.x += Math.cos(rad) * -sway;
                tmp.z += Math.sin(rad) * sway;
                setPose(tmp, yaw, pitch);
                if (t >= D) { phase = 'descend'; t = 0; }
                break;
            }
            case 'descend': {
                // hips back+down; torso leans (gaze dips), head stays fairly
                // level, one shoulder trails (yaw wobble); just before contact
                // the head lifts slightly to stabilise; soft overshoot at touch
                const D = 1.5;
                const k = clamp01(t / D);
                const drop = easeInOut(k);
                tmp.lerp(standPos, seatedPos, drop);
                // contact overshoot: sink 18mm past, recovered in 'settle'
                if (k > 0.92) tmp.y -= 0.018 * easeOut((k - 0.92) / 0.08);
                // torso lean → gaze dips mid-descent, stabilises up at the end
                const lean = Math.sin(clamp01(k * 1.25) * Math.PI);
                let pitch = -8 - 7 * lean;                     // to ~-15° mid
                if (k > 0.8) pitch += 5 * easeOut((k - 0.8) / 0.2);  // head lifts
                // trailing shoulder
                const yaw = sitYaw + Math.sin(k * Math.PI) * 2.6 * turnDir;
                setPose(tmp, yaw, pitch);
                if (t >= D) { phase = 'settle'; t = 0; }
                break;
            }
            case 'settle': {
                // pelvis rights itself (rise out of the overshoot), a small
                // shuffle back onto the seat, feet re-place (tiny lateral),
                // head finds its final line last
                const D = 0.9;
                const k = clamp01(t / D);
                const rad = sitYaw * math.DEG_TO_RAD;
                tmp.copy(seatedPos);
                tmp.y -= 0.018 * (1 - easeOut(Math.min(1, k * 1.6)));
                const shuffle = Math.sin(clamp01(k * 1.4) * Math.PI) * 0.012;
                tmp.x -= -Math.sin(rad) * shuffle;             // a touch backward
                tmp.z -= -Math.cos(rad) * shuffle;
                const pitch = -3 + Math.sin(k * Math.PI * 2) * 0.7;  // final micro-nod
                const yaw = sitYaw + (1 - k) * 1.2 * turnDir;
                setPose(tmp, yaw, pitch);
                if (t >= D) {
                    phase = 'seated'; t = 0; breathe = 0;
                    pill.textContent = '🧍 Aufstehen';
                    pill.classList.add('seatedMode', 'show');
                }
                break;
            }
            case 'seated': {
                // parked: rotation stays FREE (look around while seated); the
                // position is pinned to the seat with a breathing micro-sway.
                // Standing up is EXPLICIT: the pill (now "Aufstehen") or any
                // move key — no fragile drift heuristics.
                breathe += dt;
                const cam = cmCam();
                cam.position.x = seatedPos.x;
                cam.position.z = seatedPos.z;
                cam.position.y = seatedPos.y + Math.sin(breathe * 2 * Math.PI * 0.22) * 0.004;
                cm.snap();
                break;
            }
            case 'stand': {
                // condensed reverse: lean forward, push up to standing in
                // front of the seat, gaze levels — then hand back to walking
                const D = 1.05;
                const k = clamp01(t / D);
                const up = easeInOut(k);
                tmp.lerp(startPos, standPos, up);
                let pitch = startPitch + (-10 - startPitch) * easeOut(Math.min(1, k * 2.2));
                if (k > 0.35) pitch += (0 - pitch) * easeInOut((k - 0.35) / 0.65);
                const yaw = startYaw + yawDelta(startYaw, sitYaw) * up * 0.3;
                setPose(tmp, yaw, pitch);
                if (t >= D) finishToWalk(true);
                break;
            }
        }
        app.renderNextFrame = true;
    });

    const beginStand = () => {
        if (phase !== 'seated') return;
        const cam = cmCam();
        phase = 'stand';
        t = 0;
        startPos.copy(cam.position);
        startYaw = cam.angles.y;
        startPitch = cam.angles.x;
        pill.classList.remove('show', 'seatedMode');
        pill.textContent = '🪑 Platz nehmen';
    };

    pill.addEventListener('click', () => {
        if (phase === 'seated') { beginStand(); return; }
        const s = (pill as any).__seat as Seat | undefined;
        if (s) beginSit(s);
    });

    // move keys while seated = the natural "I want to get up"
    window.addEventListener('keydown', (e) => {
        if (phase !== 'seated') return;
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            beginStand();
        }
    });

    // a mode change from outside (toolbar: aerial/dollhouse/…) tears down cleanly
    events.on('cameraMode:changed', () => {
        if (phase !== 'idle' && state.cameraMode !== 'fly') {
            finishToWalk(false);
        }
    });
};

export { initSit };
