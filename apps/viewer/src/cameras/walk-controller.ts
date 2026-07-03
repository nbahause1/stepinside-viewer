import { math, Vec3 } from 'playcanvas';

import type { Collision, PushOut } from '../collision';
import type { CameraFrame, Camera, CameraController } from './camera';
import { DEFAULT_CONTROLLER_DAMPING, applyFrameRotation, dampAngles, setBasisOffset, setYawBasis } from './camera-utils';
import { IdleLook } from './idle-look';
import { SpawnState } from './spawn-state';
import { applySmoothedZoom } from './zoom';
import { findCylinderSpawn } from '../collision/find-spawn';
import { damp } from '../core/math';

/**
 * Upper bound on a single physics sub-step (seconds). Locomotion integrates up
 * to the real frame time so motion is as smooth as the display refresh, but the
 * stiff ground spring needs a small dt to stay stable, so a long frame is split
 * into sub-steps no larger than this.
 */
const MAX_STEP_DT = 1 / 60;

/**
 * Clamp on a single frame's delta (seconds) before integration, so a stall
 * (tab refocus, GC pause) can't teleport the capsule through walls/floor.
 * Equivalent to the old 10-substep ceiling.
 */
const MAX_FRAME_DT = 10 / 60;

// Walking gaze-scan tuning. While moving, the view sweeps the room so it reads
// as "looking around" within the 1-3 s of a walk. CRITICAL for smoothness: yaw
// and pitch are COUPLED — yaw uses sine and pitch uses cosine at the SAME two
// frequencies (a 90° phase offset). Each frequency therefore traces a smooth
// ellipse, and their sum is an epicyclic curve, so the gaze always moves in one
// continuous curving loop (left → down → right → up …). Independent yaw/pitch
// sines instead make a Lissajous that periodically collapses to a back-and-forth
// diagonal line, which reads as segmented "horizontal, then vertical" motion —
// the un-smooth feel we are fixing. Amplitudes in degrees, periods in seconds;
// the two non-harmonic periods keep the loop organic and non-repeating. Yaw
// amplitude > pitch so the loop is a wide oval (more side-to-side than up-down).
const GAZE_PERIOD_1 = 5;
const GAZE_PERIOD_2 = 8;
const GAZE_YAW_AMP_1 = 6;
const GAZE_YAW_AMP_2 = 2.5;
const GAZE_PITCH_AMP_1 = 4;
const GAZE_PITCH_AMP_2 = 1.5;
/** Gaze ramp-IN rate (per second) when walking starts — gentle ease-in. */
const GAZE_RAMP_IN_RATE = 1.4;
/**
 * Velocity damping for the gaze COAST-to-rest when locomotion input stops. The
 * scan does NOT spring back to forward (that snap read as un-smooth); instead
 * its velocity eases to 0 so it glides to a halt wherever it was looking, and
 * that pose is then folded into the heading — the end-of-walk frame becomes the
 * start-of-standing frame. `damp(d, dt)` style: higher = gentler/longer glide.
 */
const GAZE_COAST_DAMPING = 0.99;
/** Per-frame look input (deg) above which the user counts as actively aiming. */
const GAZE_AIM_EPS = 0.15;
const TWO_PI = Math.PI * 2;

/** Pre-allocated push-out vector for capsule collision */
const out: PushOut = { x: 0, y: 0, z: 0 };

const v = new Vec3();
const d = new Vec3();

const forward = new Vec3();
const right = new Vec3();
const moveStep = [0, 0, 0];

const offset = new Vec3();
const spawnProbe = new Vec3();

/**
 * First-person camera controller with spring-damper suspension over collision terrain.
 *
 * Movement is constrained to the horizontal plane (XZ) relative to the camera yaw.
 * Vertical positioning uses a spring-damper system that hovers the capsule above the
 * collision surface, filtering out terrain noise for smooth camera motion. Capsule
 * collision handles walls and obstacles. When airborne, normal gravity applies.
 */
class WalkController implements CameraController {
    /**
     * Optional collision for capsule collision with sliding
     */
    collision: Collision | null = null;

    /**
     * Field of view in degrees for walk mode. Slightly wider than orbit/fly so
     * the room opens up like a human walkthrough; kept modest (not GoPro-wide)
     * to avoid rectilinear edge stretching. The peripheral-vision feel (soft,
     * present edges) is carried by the walk-mode vignette overlay, not by FOV.
     */
    fov = 96;

    /**
     * Total capsule height in meters (default: human proportion)
     */
    capsuleHeight = 1.5;

    /**
     * Capsule radius in meters
     */
    capsuleRadius = 0.2;

    /**
     * Camera height from the bottom of the capsule in meters
     */
    eyeHeight = 1.3;

    /**
     * Gravity acceleration in m/s^2
     */
    gravity = 9.8;

    /**
     * Jump velocity in m/s
     */
    jumpSpeed = 4;

    /**
     * Movement speed in m/s when grounded
     */
    moveGroundSpeed = 3.4;

    /**
     * Movement speed in m/s when in the air (for air control)
     */
    moveAirSpeed = 1;

    /**
     * Rotation damping factor (0 = no damping, 1 = full damping)
     */
    rotateDamping = DEFAULT_CONTROLLER_DAMPING;

    /**
     * Velocity damping factor when grounded (0 = no damping, 1 = full damping)
     */
    velocityDampingGround = 0.99;

    /**
     * Velocity damping factor when in the air (0 = no damping, 1 = full damping)
     */
    velocityDampingAir = 0.998;

    /**
     * Target clearance from capsule bottom to ground surface in meters.
     * The capsule hovers this far above terrain to avoid bouncing on noisy surfaces.
     */
    hoverHeight = 0.2;

    /**
     * Spring stiffness for ground-following suspension (higher = stiffer tracking).
     */
    springStiffness = 800;

    /**
     * Damping coefficient for ground-following suspension.
     * Critical damping is approximately 2 * sqrt(springStiffness).
     */
    springDamping = 57;

    /**
     * Maximum downward raycast distance to search for ground below the capsule.
     */
    groundProbeRange = 1.0;

    private _position = new Vec3();

    private _prevPosition = new Vec3();

    private _angles = new Vec3();

    private _targetAngles = new Vec3();

    private _idleLook = new IdleLook();

    private _gazePhase = 0;

    private _gazeRamp = 0;

    private _gazeYaw = 0;

    private _gazePitch = 0;

    private _gazeYawVel = 0;

    private _gazePitchVel = 0;

    private _distance = 1;

    private _spawn = new SpawnState();

    private _spawnGrounded = false;

    private _velocity = new Vec3();

    private _grounded = false;

    private _jumping = false;

    private _jumpHeld = false;

    onEnter(camera: Camera): void {
        this.goto(camera);
        if (this.collision) {
            // Spawn is scoped to this walk-mode entry; reset so a stale spawn
            // from a previous entry can't be restored if this entry fails.
            this._spawn.clear();
            // Treat the walk capsule as a tight-superset cylinder for spawn.
            // The carve was produced with a separable XYZ dilation (flat ends,
            // no hemispheres), so cylinder math matches the data exactly.
            // Include `hoverHeight` in the height so the ceiling-clearance
            // check accounts for the placed capsule's full vertical envelope:
            // foot sits at `floor + hoverHeight`, head at `floor + hoverHeight
            // + capsuleHeight`.
            if (findCylinderSpawn(this.collision,
                camera.position.x, camera.position.y, camera.position.z,
                (this.capsuleHeight + this.hoverHeight) * 0.5, this.capsuleRadius, spawnProbe)) {
                // spawnProbe is the floor world position the cylinder rests
                // on. Eye sits hoverHeight + eyeHeight above the floor.
                this._position.set(
                    spawnProbe.x,
                    spawnProbe.y + this.hoverHeight + this.eyeHeight,
                    spawnProbe.z
                );
                this._grounded = true;
                this._velocity.y = 0;
                this._storeSpawn();
            }

            this._prevPosition.copy(this._position);
        }
    }

    update(deltaTime: number, inputFrame: CameraFrame, camera: Camera) {
        const { move, rotate } = inputFrame.read();

        // apply rotation at display rate for responsive mouse look
        applyFrameRotation(this._targetAngles, rotate);

        // organic idle look-around when the visitor leaves the scene still
        const active = !!(rotate[0] || rotate[1] || rotate[2] || move[0] || move[1] || move[2]);
        this._idleLook.update(deltaTime, active, this._targetAngles);

        dampAngles(this._angles, this._targetAngles, this.rotateDamping, deltaTime);

        // Integrate locomotion up to the true frame time so the rendered
        // position is always current. Running in lockstep with the display
        // (like the fly controller) removes the fixed-60Hz quantization that
        // made combined walking+turning look stepped on high-refresh displays.
        // The per-frame move displacement is split across sub-steps (`frac`) so
        // total motion is identical regardless of how many sub-steps a long
        // frame needs.
        const frameDt = Math.min(deltaTime, MAX_FRAME_DT);
        let remaining = frameDt;
        while (remaining > 1e-6) {
            const stepDt = Math.min(remaining, MAX_STEP_DT);
            const frac = stepDt / frameDt;
            moveStep[0] = move[0] * frac;
            moveStep[1] = move[1];
            moveStep[2] = move[2] * frac;
            this._prevPosition.copy(this._position);
            this._step(stepDt, moveStep);
            remaining -= stepDt;
        }

        camera.position.copy(this._position);
        camera.distance = this._distance;
        camera.fov = applySmoothedZoom(this.fov, deltaTime);

        // Walking gaze-scan: while moving (and not actively aiming), sweep the
        // view around the travel heading so the gaze isn't a dead locked-forward
        // stare. It is a render-only offset (camera.gazeYaw/Pitch) the navigation
        // never reads back, so steering can't cancel it; works for click-to-walk
        // and WASD. On stopping it does NOT spring back to forward — that snap
        // read as un-smooth. Instead the offset COASTS to a halt at its current
        // direction (velocity eased to 0), then that resting pose is folded into
        // the heading: the end-of-walk frame becomes the start-of-standing frame,
        // seamlessly, and the idle look-around takes over from there.
        const aiming = Math.abs(rotate[0]) > GAZE_AIM_EPS || Math.abs(rotate[1]) > GAZE_AIM_EPS;
        const movingIntent = Math.abs(move[0]) > 1e-4 || Math.abs(move[2]) > 1e-4;
        const wantGaze = movingIntent && !aiming;
        this._gazePhase += deltaTime;
        if (wantGaze) {
            this._gazeRamp = Math.min(1, this._gazeRamp + GAZE_RAMP_IN_RATE * deltaTime);
            const gt = this._gazePhase;
            const gw1 = TWO_PI / GAZE_PERIOD_1;
            const gw2 = TWO_PI / GAZE_PERIOD_2;
            // yaw = sine, pitch = cosine at each frequency → 90°-coupled, so the
            // gaze sweeps one smooth ellipse (vertical/horizontal blended, no
            // segmented "sideways then up/down"); smoothstep eases the scan in.
            const yawOff = GAZE_YAW_AMP_1 * Math.sin(gt * gw1) + GAZE_YAW_AMP_2 * Math.sin(gt * gw2 + 0.7);
            const pitchOff = GAZE_PITCH_AMP_1 * Math.cos(gt * gw1) + GAZE_PITCH_AMP_2 * Math.cos(gt * gw2 - 0.4);
            const env = this._gazeRamp * this._gazeRamp * (3 - 2 * this._gazeRamp);
            const ny = yawOff * env;
            const np = pitchOff * env;
            this._gazeYawVel = (ny - this._gazeYaw) / deltaTime;
            this._gazePitchVel = (np - this._gazePitch) / deltaTime;
            this._gazeYaw = ny;
            this._gazePitch = np;
        } else if (this._gazeRamp > 0 || this._gazeYaw !== 0 || this._gazePitch !== 0) {
            // coast the scan to a halt where it is (no return to forward), then
            // fold the resting offset into the heading so standing continues from
            // exactly that pose. The rendered angle is unchanged across the fold
            // (heading + gaze == new heading + 0), so it is seamless.
            this._gazeRamp = 0;
            const coast = damp(GAZE_COAST_DAMPING, deltaTime);
            this._gazeYawVel = math.lerp(this._gazeYawVel, 0, coast);
            this._gazePitchVel = math.lerp(this._gazePitchVel, 0, coast);
            this._gazeYaw += this._gazeYawVel * deltaTime;
            this._gazePitch += this._gazePitchVel * deltaTime;
            if (Math.abs(this._gazeYawVel) < 2 && Math.abs(this._gazePitchVel) < 2) {
                this._angles.y += this._gazeYaw;
                this._angles.x = math.clamp(this._angles.x + this._gazePitch, -90, 90);
                this._targetAngles.y += this._gazeYaw;
                this._targetAngles.x = math.clamp(this._targetAngles.x + this._gazePitch, -90, 90);
                this._gazeYaw = 0;
                this._gazePitch = 0;
                this._gazeYawVel = 0;
                this._gazePitchVel = 0;
            }
        }

        camera.angles.set(this._angles.x, this._angles.y, 0);
        camera.gazeYaw = this._gazeYaw;
        camera.gazePitch = this._gazePitch;
    }

    private _step(dt: number, move: number[]) {
        // ground probe: cast a ray downward to find the terrain surface
        const groundY = this._probeGround(this._position);
        const hasGround = groundY !== null;

        // jump (require release before re-triggering)
        if (this._velocity.y < 0) {
            this._jumping = false;
        }
        if (move[1] && !this._jumping && this._grounded && !this._jumpHeld) {
            this._jumping = true;
            this._velocity.y = this.jumpSpeed;
            this._grounded = false;
        }
        this._jumpHeld = !!move[1];

        // vertical force: spring-damper when ground is detected, gravity when airborne
        if (hasGround && !this._jumping) {
            const targetY = groundY + this.hoverHeight + this.eyeHeight;
            const displacement = this._position.y - targetY;

            if (displacement > 0.1) {
                // well above target (jump/ledge): freefall, snap to rest height on arrival
                this._velocity.y -= this.gravity * dt;
                const nextY = this._position.y + this._velocity.y * dt;
                if (nextY <= targetY) {
                    this._position.y = targetY;
                    this._velocity.y = 0;
                }
                this._grounded = false;
            } else {
                // at or near target (walking/slopes): spring tracks terrain
                const springForce = -this.springStiffness * displacement - this.springDamping * this._velocity.y;
                this._velocity.y += springForce * dt;
                this._grounded = true;
            }
        } else {
            this._velocity.y -= this.gravity * dt;
            this._grounded = false;
        }

        // move
        setYawBasis(this._angles.y, forward, right);
        setBasisOffset(offset, move[0], 0, move[2], forward, right, Vec3.UP);
        this._velocity.add(offset.mulScalar(this._grounded ? this.moveGroundSpeed : this.moveAirSpeed));

        const dampFactor = this._grounded ? this.velocityDampingGround : this.velocityDampingAir;
        const alpha = damp(dampFactor, dt);
        this._velocity.x = math.lerp(this._velocity.x, 0, alpha);
        this._velocity.z = math.lerp(this._velocity.z, 0, alpha);

        this._position.add(v.copy(this._velocity).mulScalar(dt));

        // capsule collision: walls, ceiling, and fallback floor contact
        this._checkCollision(this._position, d);
    }

    onExit(_camera: Camera): void {
        // nothing to clean up
    }

    /**
     * Teleport the controller to a given camera state (used for transitions).
     *
     * @param camera - The camera state to jump to.
     */
    goto(camera: Camera) {
        // position
        this._position.copy(camera.position);
        this._prevPosition.copy(this._position);

        // angles (clamp pitch to avoid gimbal lock)
        this._angles.set(camera.angles.x, camera.angles.y, 0);
        this._targetAngles.copy(this._angles);
        this._distance = camera.distance;

        // reset velocity and state
        this._resetMotion();
        this._idleLook.reset();
        this._gazePhase = 0;
        this._gazeRamp = 0;
        this._gazeYaw = 0;
        this._gazePitch = 0;
        this._gazeYawVel = 0;
        this._gazePitchVel = 0;
    }

    /**
     * Reset the controller to the spawn pose captured on the last walk-mode entry.
     *
     * @param camera - Camera state to update with the spawn pose.
     * @returns True if a spawn pose was available.
     */
    resetToSpawn(camera: Camera): boolean {
        if (!this._spawn.has) {
            return false;
        }

        this._distance = this._spawn.restore(this._position, this._angles);
        this._prevPosition.copy(this._position);
        this._targetAngles.copy(this._angles);
        this._resetMotion();
        this._grounded = this._spawnGrounded;

        camera.position.copy(this._position);
        camera.angles.copy(this._angles);
        camera.distance = this._distance;
        camera.fov = this.fov;

        return true;
    }

    private _storeSpawn() {
        this._spawn.store(this._position, this._angles, this._distance);
        this._spawnGrounded = this._grounded;
    }

    private _resetMotion() {
        this._velocity.set(0, 0, 0);
        this._grounded = false;
        this._jumping = false;
        this._jumpHeld = false;
    }

    /**
     * Cast multiple rays downward to find the average ground surface height.
     * Uses 5 rays (center + 4 cardinal at capsule radius) to spatially filter
     * noisy collision heights, giving the spring a smoother target.
     *
     * @param pos - Eye position in PlayCanvas world space.
     * @returns Average ground surface Y in PlayCanvas space, or null if no ground found.
     */
    private _probeGround(pos: Vec3): number | null {
        if (!this.collision) return null;

        const oy = pos.y - this.eyeHeight;
        const r = this.capsuleRadius;
        const range = this.groundProbeRange;

        let totalY = 0;
        let hitCount = 0;

        for (let i = 0; i < 5; i++) {
            let ox = pos.x;
            let oz = pos.z;
            if (i === 1) ox -= r;
            else if (i === 2) ox += r;
            else if (i === 3) oz += r;
            else if (i === 4) oz -= r;

            const hit = this.collision.queryRay(ox, oy, oz, 0, -1, 0, range);
            if (hit) {
                totalY += hit.y;
                hitCount++;
            }
        }

        return hitCount > 0 ? totalY / hitCount : null;
    }

    /**
     * Check for capsule collision and apply push-out displacement.
     * Handles walls, ceiling hits, and fallback floor contact when airborne.
     *
     * @param pos - Eye position in PlayCanvas world space.
     * @param disp - Pre-allocated vector to receive the collision push-out displacement.
     */
    private _checkCollision(pos: Vec3, disp: Vec3) {
        const center = pos.y - this.eyeHeight + this.capsuleHeight * 0.5;
        const half = this.capsuleHeight * 0.5 - this.capsuleRadius;

        if (this.collision!.queryCapsule(pos.x, center, pos.z, half, this.capsuleRadius, out)) {
            disp.set(out.x, out.y, out.z);
            pos.add(disp);

            // ceiling collision: cancel upward velocity
            if (disp.y < 0 && this._velocity.y > 0) {
                this._velocity.y = 0;
            }

            // airborne floor collision: transition to grounded as a fallback safety net
            if (!this._grounded && disp.y > 0 && this._velocity.y < 0) {
                this._velocity.y = 0;
                this._grounded = true;
            }
        }
    }
}

export { WalkController };
