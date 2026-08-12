import { Vec3, math } from 'playcanvas';

import type { CameraManager } from './camera-manager';
import { IdleLook } from './cameras/idle-look';
import type { Collision } from './collision';
import { findCylinderSpawn } from './collision/find-spawn';
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

type Phase = 'idle' | 'approach' | 'turn' | 'descend' | 'settle' | 'seated' | 'stand';

/** eye height above the SEAT surface when seated (m) */
const SEATED_EYE_ABOVE_SEAT = 0.62;

/** walk rig eye height above ground: hoverHeight (0.2) + eyeHeight (1.3).
 *  MUST match walk-controller.ts — the stand-up ends exactly here so the
 *  hand-back to walking is seamless (no height pop). */
const WALK_EYE = 1.5;

/** where the body stands before sitting: this far in front of the seat edge */
const STAND_AHEAD = 0.42;

/** Cull seat markers beyond this distance (m, XZ). Unlimited by default: the
 *  marks are how a visitor learns that sitting is possible at all, and tapping
 *  one walks you over, so there is no distance at which hiding it helps. Set a
 *  number here only if a scan ever gets large enough for far marks to clutter. */
const MARKER_DIST = Infinity;

/** how high above the seat surface the chevron floats (m). Roughly the head
 *  height of someone sitting there: high enough to clear the backrest and the
 *  furniture silhouette from every angle, low enough to still belong to the
 *  seat rather than hover in the room. */
const MARKER_LIFT = 0.85;

/** Walk capsule, mirrored from walk-controller.ts (capsuleHeight 1.5,
 *  hoverHeight 0.2, capsuleRadius 0.2). Walk's onEnter re-places the camera on
 *  the cylinder spawn it finds for itself; asking the SAME question up front
 *  lets the stand-up land on that exact pose, so the mode switch moves nothing.
 *  Keep in sync — a drift here reappears as a jump when standing up. */
const WALK_CAPSULE_HALF = (1.5 + 0.2) * 0.5;
const WALK_CAPSULE_RADIUS = 0.2;

/** the pitch a stand-up ends on (degrees): level, looking straight ahead —
 *  what a person does when they get to their feet and walk on. */
const STAND_END_PITCH = 0;

/** auto-walk is considered arrived within this distance of the standing spot (m) */
const ARRIVE_DIST = 0.55;

/** safety net: never wait longer than this for the auto-walk to arrive (s) */
const APPROACH_TIMEOUT = 12;

const easeInOut = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => math.clamp(t, 0, 1);

const initSit = (global: Global, collision: Collision | null, getCM: () => CameraManager | null) => {
    const { app, events, settings, state } = global;
    const seats: Seat[] = Array.isArray((settings as any).seats)
        ? (settings as any).seats.filter((s: any) => Array.isArray(s?.position) && typeof s?.yaw === 'number')
        : [];
    if (!seats.length) return;

    // ---- UI ----------------------------------------------------------------
    // Subtle white chevrons in a hairline ring, breathing quietly — no plate,
    // no label, no emoji. They mark places rather than announcing a feature,
    // which is the only register that survives next to a photoreal room.
    // Styles live in index.scss (.sitPill).
    //
    //   every seat → chevron down, anchored in the scene, always visible
    //   seated     → one chevron up, fixed bottom centre
    //
    // Tapping a seat mark at ANY distance walks you over first (phase
    // 'approach') and then sits you down — no positioning by hand.
    // Ring and chevron are ONE svg of pure strokes, drawn twice: a dark hairline
    // underneath, the white line on top. That underlay is what makes it legible
    // on a bright wall — a glow cannot create contrast against white. Filling
    // the circle and glowing the element (the obvious route) blurs the whole
    // disc into a smudge, because a drop-shadow follows the silhouette.
    const MARK_SVG = '<svg class="sitPill__mark" viewBox="0 0 40 40" aria-hidden="true">' +
        '<g class="sitPill__under">' +
        '<circle cx="20" cy="20" r="14.5" />' +
        '<path class="sitPill__chev" d="M13.5 17.5 L20 24 L26.5 17.5" />' +
        '</g>' +
        '<g class="sitPill__line">' +
        '<circle cx="20" cy="20" r="14.5" />' +
        '<path class="sitPill__chev" d="M13.5 17.5 L20 24 L26.5 17.5" />' +
        '</g></svg>';

    const layer = document.getElementById('ui') ?? document.body;

    const newMark = (aria: string) => {
        const el = document.createElement('button');
        el.className = 'sitPill';
        el.type = 'button';
        el.setAttribute('aria-label', aria);
        el.innerHTML = MARK_SVG;
        layer.appendChild(el);
        return el;
    };

    // ONE MARKER PER SEAT. The earlier single shared element could only ever
    // show the nearest seat, so in a room with several the others were simply
    // invisible — you had to walk up to each one to discover it existed. Every
    // authored seat now carries its own mark, all of them visible at once.
    const markers = seats.map((s) => {
        const el = newMark('Platz nehmen');
        el.addEventListener('click', () => approachAndSit(s));
        return { el, seat: s };
    });

    // The stand-up arrow is its own element, fixed bottom centre. Separate on
    // purpose: it is not anchored to anything in the scene, and reusing a seat
    // marker for it is what made it inherit a projected position.
    const standBtn = newMark('Aufstehen');
    standBtn.classList.add('up', 'seatedMode');
    standBtn.addEventListener('click', () => beginStand());

    const hideMarkers = () => {
        for (const m of markers) m.el.classList.remove('show');
    };

    /**
     * Park a mark at a projected screen point.
     *
     * Uses `transform`, not `left`/`top`: those are layout properties, so every
     * frame of camera movement forced a reflow and the mark arrived a beat
     * behind the image — the "not smooth" drift. A composited transform is
     * subpixel-exact and rides along with the canvas.
     */
    const placeAt = (el: HTMLElement, x: number, y: number) => {
        el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    };

    // ---- animation state ---------------------------------------------------
    let phase: Phase = 'idle';
    let t = 0;                          // seconds into the current phase
    let seat: Seat | null = null;
    let fromMode: 'walk' = 'walk';
    let pendingSeat: Seat | null = null;      // the seat the auto-walk is heading for
    const approachTarget = new Vec3();        // its standing spot (world)
    const approachNormal = new Vec3(0, 1, 0); // navigateTo's marker normal
    const spawnProbe = new Vec3();            // walk's own spawn answer, for the stand-up target
    const viewPos = new Vec3();               // scratch for the behind-camera test

    // poses (world)
    const startPos = new Vec3();        // pose when the sit began
    let startYaw = 0, startPitch = 0;
    const standPos = new Vec3();        // standing point in front of the seat
    const seatedPos = new Vec3();       // seated eye position
    let sitYaw = 0;                     // yaw of the seated person
    let turnDir = 1;                    // over which shoulder the body turns
    let breathe = 0;                    // breathing clock while seated
    let walkEyeY0 = 0;                  // the walk rig's eye height when the sit began (truth + sanity bound)
    const sitEntryPos = new Vec3();     // the PROVEN-VALID walk pose the visitor sat down from — stand-up returns here
    // The entry YAW and PITCH are deliberately NOT restored on standing up.
    // On the way in you faced the seat and looked down at it; replaying that
    // would spin the visitor round to stare at the furniture. Standing up
    // holds the current yaw and levels the pitch — see STAND_END_PITCH.
    let sitFov = 80;                    // the WALK camera's fov, held constant through the whole sit — the fly rig has its own (narrower) fov and letting it apply reads as a zoom pop
    let flyFov0 = 0;                    // the fly rig's OWN fov, restored on exit. The pin must live ON the controller: fly.update() re-writes controllers.fly.fov into the camera every frame BEFORE render, so camera.fov + snap() from this (later-registered) handler never reaches the screen

    const tmp = new Vec3();

    const cmCam = () => getCM()!.camera;

    const setPose = (p: Vec3, yaw: number, pitch: number) => {
        const cm = getCM();
        if (!cm) return;
        cm.camera.position.copy(p);
        cm.camera.angles.set(pitch, yaw, 0);
        cm.camera.distance = 0;        // first-person: eye IS the pose
        cm.camera.fov = sitFov;        // keep the manager's pose coherent (share links etc.) — the RENDERED fov is pinned via setFlyFov in beginSit
        cm.snap();
    };

    // shortest signed angle a→b in degrees
    const yawDelta = (a: number, b: number) => {
        let d = (b - a) % 360;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        return d;
    };

    /** The spot the body stands on before sitting: STAND_AHEAD in front of the
     *  seat, facing it. Needed BEFORE the sit begins so the auto-walk has a
     *  destination, hence its own function rather than inline in beginSit. */
    const standSpotFor = (s: Seat, out: Vec3) => {
        const rad = s.yaw * math.DEG_TO_RAD;
        out.set(s.position[0] - Math.sin(rad) * STAND_AHEAD,
            s.position[1],
            s.position[2] - Math.cos(rad) * STAND_AHEAD);
        return out;
    };

    const beginSit = (s: Seat) => {
        const cm = getCM();
        // 'approach' is a legal entry too: the auto-walk hands straight over
        if (!cm || state.cameraMode !== 'walk' || (phase !== 'idle' && phase !== 'approach')) return;
        seat = s;
        phase = 'turn';
        t = 0;
        state.measuring = true;         // blocks click-to-walk / tour / focusPoi hijacks
        IdleLook.suppressed = true;
        hideMarkers();

        const cam = cmCam();
        startPos.copy(cam.position);
        startYaw = cam.angles.y;
        startPitch = cam.angles.x;
        sitFov = cam.fov;

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
        walkEyeY0 = startPos.y;
        sitEntryPos.copy(startPos);

        seatedPos.set(sp.x, sp.y + SEATED_EYE_ABOVE_SEAT, sp.z);
        sitYaw = s.yaw;
        // turn over the shoulder that gives the shorter way
        turnDir = yawDelta(startYaw, sitYaw) >= 0 ? 1 : -1;
        // pin the walk fov onto the fly rig itself — its update() writes its
        // controller fov every frame, so this is the only write that renders
        flyFov0 = cm.getFlyFov();
        cm.setFlyFov(sitFov);
        state.cameraMode = 'fly';       // the invisible free rig
        setPose(startPos, startYaw, startPitch);
    };

    const finishToWalk = (standUp: boolean) => {
        phase = 'idle';
        seat = null;
        standBtn.classList.remove('show');
        state.measuring = false;
        IdleLook.suppressed = false;
        const cm2 = getCM();
        // hand the fly rig back its own fov (pinned in beginSit)
        if (cm2 && flyFov0 > 0) {
            cm2.setFlyFov(flyFov0);
            flyFov0 = 0;
        }
        if (standUp && cm2) {
            cm2.camera.fov = sitFov;            // walk renders this same fov itself
            state.cameraMode = fromMode;        // walk re-grounds at the current XZ
            cm2.snap();
        }
    };

    app.on('update', (dt: number) => {
        const cm = getCM();
        if (!cm) return;

        // ---- auto-walk toward a tapped seat --------------------------------
        if (phase === 'approach') {
            t += dt;
            const cam = cmCam();
            const d = Math.hypot(approachTarget.x - cam.position.x, approachTarget.z - cam.position.z);
            if (pendingSeat && d <= ARRIVE_DIST) {
                const s = pendingSeat;
                pendingSeat = null;
                beginSit(s);                    // arrived — sit down without pause
            } else if (t > APPROACH_TIMEOUT || state.cameraMode !== 'walk') {
                abortApproach();                // blocked, or the visitor left walking
            }
            app.renderNextFrame = true;
            return;
        }

        // ---- seat markers (walk mode only) ---------------------------------
        // EVERY authored seat is marked, all the time: the marks are how the
        // visitor learns that sitting is possible at all, so hiding the ones
        // further away hides the feature. The only reasons to drop one are that
        // it is behind the camera or beyond MARKER_DIST. Tapping any of them
        // walks you over first — see approachAndSit.
        if (phase === 'idle') {
            const visible = state.cameraMode === 'walk' && !state.measuring && state.loaded;
            if (!visible) {
                hideMarkers();
                return;
            }
            const cam = cmCam();
            const camComp = (global.camera as any).camera;
            for (const m of markers) {
                const p = m.seat.position;
                const d = Math.hypot(p[0] - cam.position.x, p[2] - cam.position.z);
                if (d > MARKER_DIST) {
                    m.el.classList.remove('show');
                    continue;
                }
                tmp.set(p[0], p[1] + MARKER_LIFT, p[2]);
                camComp.viewMatrix.transformPoint(tmp, viewPos);
                if (viewPos.z < 0) {
                    const s2 = camComp.worldToScreen(tmp);
                    placeAt(m.el, s2.x, s2.y);
                    m.el.classList.add('show');
                } else {
                    m.el.classList.remove('show');   // behind the camera
                }
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
                // contact: a soft 10mm give as the weight lands, recovered in
                // 'settle' — spread over the last 15% so it never reads as a jolt
                if (k > 0.85) tmp.y -= 0.010 * easeInOut((k - 0.85) / 0.15);
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
                tmp.y -= 0.010 * (1 - easeOut(Math.min(1, k * 1.6)));
                const shuffle = Math.sin(clamp01(k * 1.4) * Math.PI) * 0.012;
                tmp.x -= -Math.sin(rad) * shuffle;             // a touch backward
                tmp.z -= -Math.cos(rad) * shuffle;
                const pitch = -3 + Math.sin(k * Math.PI * 2) * 0.7;  // final micro-nod
                const yaw = sitYaw + Math.sin(k * Math.PI) * 0.6 * turnDir;
                setPose(tmp, yaw, pitch);
                if (t >= D) {
                    phase = 'seated'; t = 0; breathe = 0;
                    standBtn.classList.add('show');
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
                cam.fov = sitFov;
                cm.snap();
                break;
            }
            case 'stand': {
                // condensed reverse: lean forward, push up and step back to
                // where we sat down from, gaze levels — then hand to walking
                const dist = Math.hypot(standPos.x - seatedPos.x, standPos.z - seatedPos.z);
                const D = 1.05 + Math.max(0, dist - 0.45) * 0.45;
                const k = clamp01(t / D);
                const up = easeInOut(k);
                tmp.lerp(startPos, standPos, up);
                // The look returns to the pre-sit look EXACTLY. The downward
                // glance while the body pushes up is a bump function (sin over
                // a clamped argument): it peaks mid-way and is exactly 0 at
                // k=1, so it colours the movement without displacing its end.
                const dip = -6 * Math.sin(clamp01(k * 1.15) * Math.PI);
                const pitch = startPitch + (STAND_END_PITCH - startPitch) * up + dip;
                // Yaw is held EXACTLY as it is. Nobody turns around while
                // getting to their feet: you push up and carry on facing where
                // you were already looking. Steering the yaw anywhere — least
                // of all back to the entry direction, which pointed AT the
                // seat — is the camera spinning the visitor round on standing.
                const yaw = startYaw;
                setPose(tmp, yaw, pitch);
                if (t >= D) {
                    // land on the entry pose to the frame — no residual from
                    // the easing, nothing for the walk hand-back to correct
                    setPose(standPos, startYaw, STAND_END_PITCH);
                    finishToWalk(true);
                }
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
        // Where the stand-up ends. Two requirements pull in the same direction:
        //
        // 1. The spot must be walkable — the entry pose qualifies by proof, the
        //    visitor stood there seconds ago.
        // 2. It must be the pose walk will CHOOSE. Its onEnter runs
        //    findCylinderSpawn from whatever pose it is handed and relocates
        //    the camera onto the result — so if the animation ends anywhere
        //    else, the mode switch snaps. That snap is the remaining break.
        //
        // So ask walk's own question here and animate to its answer, eye height
        // included (spawn floor + hover + eye = WALK_EYE). If the probe fails,
        // the proven entry pose is still the best available fallback.
        standPos.copy(sitEntryPos);
        if (collision && findCylinderSpawn(collision,
            sitEntryPos.x, sitEntryPos.y, sitEntryPos.z,
            WALK_CAPSULE_HALF, WALK_CAPSULE_RADIUS, spawnProbe)) {
            standPos.set(spawnProbe.x, spawnProbe.y + WALK_EYE, spawnProbe.z);
        }
        standBtn.classList.remove('show');
    };

    /**
     * Tap on the seat marker. The visitor should never have to walk themselves
     * into position first: from anywhere in the room this walks over (reusing
     * the viewer's own click-to-walk, so speed, gaze-lift and collision all
     * behave exactly like normal navigation) and sits down on arrival.
     */
    const approachAndSit = (s: Seat) => {
        if (phase !== 'idle' || state.cameraMode !== 'walk') return;
        const cm = getCM();
        if (!cm) return;

        standSpotFor(s, approachTarget);
        const cam = cm.camera;
        const d = Math.hypot(approachTarget.x - cam.position.x, approachTarget.z - cam.position.z);

        // already there → skip the walk, it would only read as a twitch
        if (d <= ARRIVE_DIST) { beginSit(s); return; }

        pendingSeat = s;
        phase = 'approach';
        t = 0;
        hideMarkers();
        approachNormal.set(0, 1, 0);
        events.fire('navigateTo', approachTarget, approachNormal, 1);
    };

    /** Give up on the walk and hand the visitor back their freedom. */
    const abortApproach = () => {
        if (phase !== 'approach') return;
        phase = 'idle';
        pendingSeat = null;
        t = 0;
    };

    // The walk source reports both arrival and cancellation through this one
    // event, so distance decides which of the two it was.
    events.on('navigateComplete', () => {
        if (phase !== 'approach' || !pendingSeat) return;
        const cm = getCM();
        const d = cm ? Math.hypot(approachTarget.x - cm.camera.position.x,
            approachTarget.z - cm.camera.position.z) : Infinity;
        const s = pendingSeat;
        if (d <= ARRIVE_DIST * 1.8) {
            pendingSeat = null;
            beginSit(s);
        } else {
            abortApproach();
        }
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
