import { Vec3 } from 'playcanvas';

// Organic idle look-around: after the viewer sits still for a moment, the
// camera gently lets its gaze wander around the direction the user last left it
// — imitating a person standing in the room and slowly looking about. This
// keeps the experience feeling alive and effortless for non-technical visitors
// without requiring any input. Any real input (drag / move / tap-navigation)
// instantly cancels it and re-arms the timer.
//
// The motion is built from a pair of slow, incommensurate sine waves per axis
// so it never settles into an obvious mechanical loop, and it eases in from the
// resting orientation so the transition out of stillness is imperceptible.

/** Seconds of stillness before the gaze begins to wander. */
const IDLE_DELAY = 3;

/** Seconds to ease the wander in from zero to full amplitude. */
const IDLE_RAMP = 3;

/** Degrees of horizontal (yaw) wander. */
const YAW_AMP = 13;

/** Degrees of vertical (pitch) wander. */
const PITCH_AMP = 5;

class IdleLook {
    // Global suppression: while true (e.g. measuring) the gaze never wanders —
    // the camera holds perfectly still so placing points isn't disturbed.
    static suppressed = false;

    private _idleTime = 0;

    private _phase = 0;

    private _rest = new Vec3();

    /**
     * Update the idle look-around. Call once per frame from a controller's
     * update, AFTER the user's own rotation has been applied to `targetAngles`
     * and BEFORE it is damped.
     *
     * @param dt - Frame delta time in seconds.
     * @param active - True if the user is currently providing input (drag,
     * movement, or active tap-navigation). Resets the idle timer.
     * @param targetAngles - The controller's target euler angles (x = pitch,
     * y = yaw). Mutated in place when wandering.
     */
    update(dt: number, active: boolean, targetAngles: Vec3): void {
        if (active || IdleLook.suppressed) {
            this._idleTime = 0;
            this._phase = 0;
            this._rest.copy(targetAngles);
            return;
        }

        this._idleTime += dt;

        // still within the grace period: keep tracking the user's resting gaze
        if (this._idleTime <= IDLE_DELAY) {
            this._rest.copy(targetAngles);
            return;
        }

        this._phase += dt;
        const t = this._phase;
        const ramp = Math.min(1, (this._idleTime - IDLE_DELAY) / IDLE_RAMP);

        const yaw = (Math.sin(t * 0.40) * 0.6 + Math.sin(t * 0.19 + 1.3) * 0.4) * YAW_AMP * ramp;
        const pitch = (Math.sin(t * 0.31 + 0.5) * 0.7 + Math.sin(t * 0.14) * 0.3) * PITCH_AMP * ramp;

        targetAngles.y = this._rest.y + yaw;
        targetAngles.x = this._rest.x + pitch;
    }

    /** Cancel any wander and re-arm the timer (e.g. on controller enter). */
    reset(): void {
        this._idleTime = 0;
        this._phase = 0;
    }
}

export { IdleLook };
