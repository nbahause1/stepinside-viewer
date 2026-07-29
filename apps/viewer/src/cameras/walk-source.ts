import { Vec3 } from 'playcanvas';

import type { Camera, CameraFrame } from './camera';
import {
    ProgressTracker,
    type TargetSource,
    clampTurnStep,
    getYawDiffToTarget,
    smoothTurnRate
} from './target-navigation';

/** XZ distance below which the walker considers itself arrived */
const ARRIVAL_DIST = 0.5;

/**
 * Gaze lift: clicking the floor to walk usually means the visitor is LOOKING
 * at the floor when the walk starts. A person raises their eyes when they
 * start walking — so does the camera: while auto-walking, the pitch eases up
 * to a natural walking gaze so the flat (not the parquet) fills the frame.
 * Any manual look input cancels the lift instantly (the visitor always wins).
 */
/** Pitch the lift eases toward (deg; slightly below the horizon reads natural) */
const GAZE_LIFT_TARGET = -4;

/** Only lift when the visitor is meaningfully looking DOWN at walk start */
const GAZE_LIFT_ARM_BELOW = -14;

/** Max pitch-raise rate (deg/s) — brisk but never a snap */
const GAZE_LIFT_MAX_RATE = 40;

/** Proportional gain mapping remaining pitch (deg) to raise rate */
const GAZE_LIFT_GAIN = 2.2;

/** Minimum XZ speed (m/s) to not count as blocked */
const BLOCKED_SPEED = 0.6;

/** Seconds of continuous low-progress before stopping the walk */
const BLOCKED_DURATION = 0.2;

/**
 * Generates synthetic move/rotate input to auto-walk toward a target position.
 *
 * Designed to feed into WalkController's existing update path so there is no
 * duplicated physics. Each frame it appends yaw-rotation and forward-movement
 * deltas to the shared CameraFrame, and monitors arrival / blocked conditions.
 */
class WalkSource implements TargetSource {
    /**
     * Forward input scale (matches InputController.moveSpeed for consistent
     * speed with regular WASD walking).
     */
    walkSpeed = 4;

    /**
     * Maximum yaw turn rate in degrees per second.
     */
    maxTurnRate = 192;

    /**
     * Proportional gain mapping yaw error (degrees) to desired turn rate.
     * Below maxTurnRate / turnGain degrees the turn rate scales linearly;
     * above that it is capped at maxTurnRate. The rate filter is
     * automatically critically damped so there is no overshoot.
     */
    turnGain = 5;

    /**
     * Callback fired when an auto-walk completes (arrival or obstacle).
     */
    onComplete: (() => void) | null = null;

    private _target: Vec3 | null = null;

    private _yawRate = 0;

    private _progress = new ProgressTracker();

    private _speedMul = 1;

    /** gaze lift armed for the CURRENT walk (decided on first update) */
    private _gazeLift = false;

    /** navigateTo just fired — decide on the next update whether to arm */
    private _gazeLiftPending = false;

    get isActive(): boolean {
        return this._target !== null;
    }

    /**
     * Begin auto-walking toward a world-space target position.
     *
     * @param target - The destination (XZ used for navigation).
     * @param speedMul - Forward-speed multiplier (mirrors gaming-controls
     * shift/ctrl: 2 for run, 0.5 for crawl). Defaults to 1.
     */
    navigateTo(target: Vec3, speedMul = 1) {
        if (!this._target) {
            this._target = new Vec3();
        }
        this._target.copy(target);
        this._speedMul = speedMul;
        this._progress.reset();
        this._gazeLiftPending = true;
    }

    /**
     * Stop raising the gaze for the rest of this walk — called on any manual
     * look input, so the visitor's own view control always wins.
     */
    cancelGazeLift() {
        this._gazeLift = false;
        this._gazeLiftPending = false;
    }

    /**
     * Cancel any active auto-walk.
     */
    cancel() {
        if (this._target) {
            this._target = null;
            this._yawRate = 0;
            this._progress.reset();
            this._gazeLift = false;
            this._gazeLiftPending = false;
            this.onComplete?.();
        }
    }

    /**
     * Compute walk deltas and append them to the frame. Must be called
     * before* the camera controller reads the frame.
     *
     * @param dt - Frame delta time in seconds.
     * @param camera - The current camera state (read-only).
     * @param frame - The shared CameraFrame to append deltas to.
     */
    update(dt: number, camera: Camera, frame: CameraFrame) {
        if (!this._target) return;

        const target = this._target;
        const cameraPosition = camera.position;
        const cameraAngles = camera.angles;

        const dx = target.x - cameraPosition.x;
        const dz = target.z - cameraPosition.z;
        const xzDist = Math.sqrt(dx * dx + dz * dz);

        // arrival
        if (xzDist < ARRIVAL_DIST) {
            this.cancel();
            return;
        }

        // blocked detection: compare with previous frame's distance
        if (this._progress.update(xzDist, dt, BLOCKED_SPEED, BLOCKED_DURATION)) {
            this.cancel();
            return;
        }

        // yaw toward target with smoothed turn rate
        const yawDiff = getYawDiffToTarget(dx, dz, cameraAngles.y);
        this._yawRate = smoothTurnRate(this._yawRate, yawDiff, this.maxTurnRate, this.turnGain, dt);
        const yawStep = clampTurnStep(this._yawRate, yawDiff, dt);
        this._yawRate = dt > 0 ? yawStep / dt : this._yawRate;

        // WalkController applies: _angles.y += -rotate[0]
        frame.deltas.rotate.append([-yawStep, 0, 0]);

        // gaze lift: ease the pitch up toward walking height. Armed only when
        // the walk STARTS with the camera clearly pointed at the floor (the
        // click-to-walk pose); never pulls a raised view back down, and
        // cancelGazeLift() (manual look input) stops it for good.
        if (this._gazeLiftPending) {
            this._gazeLiftPending = false;
            this._gazeLift = cameraAngles.x < GAZE_LIFT_ARM_BELOW;
        }
        if (this._gazeLift) {
            const diff = GAZE_LIFT_TARGET - cameraAngles.x;   // >0 while below target
            if (diff <= 0) {
                this._gazeLift = false;
            } else {
                const rate = Math.min(GAZE_LIFT_MAX_RATE, diff * GAZE_LIFT_GAIN);
                const step = Math.min(diff, rate * dt);
                // WalkController applies: _angles.x -= rotate[1] → negative raises
                frame.deltas.rotate.append([0, -step, 0]);
            }
        }

        // scale forward speed by alignment: turn in place first, then accelerate
        const alignment = Math.max(0, Math.cos(yawDiff * Math.PI / 180));
        frame.deltas.move.append([0, 0, this.walkSpeed * this._speedMul * dt * alignment]);
    }
}

export { WalkSource };
