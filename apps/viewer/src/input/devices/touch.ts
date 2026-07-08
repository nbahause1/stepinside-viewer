import { MultiTouchSource, Vec3 } from 'playcanvas';

import { multiplyZoom } from '../../cameras/zoom';
import type { Global } from '../../types';
import {
    DISPLACEMENT_SCALE,
    TAP_EPSILON,
    screenToWorld
} from '../shared';
import type { CameraInputFrame, InputDevice, UpdateContext } from '../shared';

const tmpV = new Vec3();
const orbitMove = new Vec3();
const flyMoveTmp = new Vec3();
const pinchMoveTmp = new Vec3();
const orbitRotate = new Vec3();
const flyRotate = new Vec3();

class TouchDevice implements InputDevice {
    orbitSpeed: number = 18;

    moveSpeed: number = 4;

    pinchSpeed: number = 0.4;

    /** Optical-zoom gain per pixel of pinch spread in first-person modes. */
    pinchZoomSensitivity: number = 0.004;

    touchRotateSensitivity: number = 1.5;

    private _source = new MultiTouchSource();

    private _global: Global | null = null;

    /** Touches currently active (running count from .read() deltas). */
    private _touchCount = 0;

    /** UI joystick value [x, y], -1..1. */
    private _joystick: [number, number] = [0, 0];

    /** Tap-detection state — touch count, max touches, and accumulated movement. */
    private _tapTouches = 0;

    private _tapMaxTouches = 0;

    private _tapDelta = 0;

    /** True for one frame after a tap is detected during gaming controls. */
    private _tapJump = false;

    private _onJoystickInput = (value: { x: number; y: number }) => {
        this._joystick[0] = value.x;
        this._joystick[1] = value.y;
    };

    get touchCount(): number {
        return this._touchCount;
    }

    attach(canvas: HTMLCanvasElement, global: Global): void {
        this._global = global;
        this._source.attach(canvas);
        global.events.on('joystickInput', this._onJoystickInput);
    }

    detach(): void {
        // MultiTouchSource doesn't expose a detach.
        if (this._global) {
            this._global.events.off('joystickInput', this._onJoystickInput);
            this._global = null;
        }
    }

    update(ctx: UpdateContext, frame: CameraInputFrame): void {
        const { touch, pinch, count } = this._source.read();
        const { isFly, isWalk, isFirstPerson, isOrbit, isAerial, gamingControls, dt, distance, cameraComponent } = ctx;

        // running touch count
        this._touchCount += count[0];

        if (isFly && gamingControls && (this._joystick[0] !== 0 || this._joystick[1] !== 0)) {
            this._global!.events.fire('navigateCancel');
        }

        // tap detection for click/tap target and focus modes
        if (isWalk || isFly || isOrbit) {
            const prevTaps = this._tapTouches;
            this._tapTouches = Math.max(0, this._tapTouches + count[0]);

            if (prevTaps === 0 && this._tapTouches > 0) {
                this._tapDelta = 0;
            }
            if (this._tapTouches > 0) {
                this._tapMaxTouches = Math.max(this._tapMaxTouches, this._tapTouches);
            }

            if (this._tapTouches > 0) {
                const prevDelta = this._tapDelta;
                this._tapDelta += Math.abs(touch[0]) + Math.abs(touch[1]) + Math.abs(pinch[0]);
                if (prevDelta < TAP_EPSILON && this._tapDelta >= TAP_EPSILON) {
                    if ((isWalk && !gamingControls) || isFly) {
                        this._global!.events.fire('navigateCancel');
                    }
                }
            }

            if (prevTaps > 0 && this._tapTouches === 0) {
                if (this._tapDelta < TAP_EPSILON && this._tapMaxTouches === 1) {
                    if (isWalk && !gamingControls) {
                        // Walk-interaction listens for this and fires navigateTo
                        // after picking.
                        this._global!.events.fire('mobileTap');
                    } else if (isWalk) {
                        this._tapJump = true;
                    } else if (isFly && !gamingControls) {
                        // Walk-interaction listens for this and fires navigateTo
                        // after picking.
                        this._global!.events.fire('mobileTap');
                    } else if (isOrbit) {
                        // Walk-interaction listens for this and sets orbit focus
                        // after picking.
                        this._global!.events.fire('mobileTap');
                    }
                }
                this._tapMaxTouches = 0;
            }
        } else {
            this._tapTouches = 0;
            this._tapMaxTouches = 0;
        }

        const orbit = isOrbit ? 1 : 0;
        const fly = isFirstPerson ? 1 : 0;
        // Bird's-eye (drone) mode: the camera holds its position; one-finger drag
        // looks around and pinch drives optical FOV zoom. On desktop this "just
        // works" because the mouse device emits rotate/wheel mode-agnostically;
        // touch gates rotate/pinch by mode, so aerial got neither — hence no
        // rotation on mobile. It steers through the SAME first-person look path as
        // walk/fly below (inverted drag + FOV-proportional sensitivity), so the
        // drone view feels identical to walking — not the orbit mapping, which is
        // mirrored and slightly more sensitive.
        const aerial = isAerial ? 1 : 0;
        const double = this._touchCount > 1 ? 1 : 0;
        const orbitFactor = (isFirstPerson || isAerial) ? cameraComponent.fov / 120 : 1;
        const dragInvert = ((isFirstPerson && !gamingControls) || isAerial) ? -1 : 1;
        // First-person modes (fly and walk) opt into the direct two-finger
        // model only outside gaming controls (gaming uses the joystick).
        const directFirstPerson = fly * (gamingControls ? 0 : 1);

        const { deltas } = frame;

        // move
        const v = tmpV.set(0, 0, 0);
        // Two-finger pan: orbit pans the target; fly strafes/rises in the
        // camera basis; walk strafes along the ground plane. Identical 1:1
        // screen-space mapping in every mode so dragging feels the same —
        // what your fingers move, the camera moves. Walk zeros y because
        // WalkController treats any nonzero move[1] as a jump trigger.
        screenToWorld(cameraComponent, touch[0], touch[1], distance, orbitMove);
        if (isWalk) {
            orbitMove.y = 0;
        }
        v.add(orbitMove.mulScalar((orbit + directFirstPerson) * double));
        if (gamingControls) {
            // joystick UI drives strafe + forward/back in fly/walk
            flyMoveTmp.set(this._joystick[0], 0, -this._joystick[1]);
            v.add(flyMoveTmp.mulScalar(fly * this.moveSpeed * dt));
        }
        // Two-finger pinch z in orbit: +z = "farther from target" (close-pinch
        // = +pinch[0] = zoom out). Aerial maps the SAME pinch to optical FOV zoom
        // via move.z (AerialController does fov -= move.z * k), sign-inverted so
        // spreading the fingers zooms IN — the natural pinch-to-zoom direction.
        pinchMoveTmp.set(0, 0, (orbit - aerial) * pinch[0]);
        v.add(pinchMoveTmp.mulScalar(double * this.pinchSpeed * DISPLACEMENT_SCALE));
        // First-person pinch is OPTICAL zoom (like pinching a photo), not a
        // dolly: spreading the fingers (pinch[0] < 0) magnifies the view.
        // Multiplicative mapping so every pixel of spread feels the same at
        // any zoom level. Walking stays on the joystick / tap-to-walk.
        if (isFirstPerson && double && pinch[0] !== 0) {
            multiplyZoom(Math.exp(-pinch[0] * this.pinchZoomSensitivity));
        }
        // tap-to-jump in walk + gaming controls
        if (isWalk && this._tapJump) {
            v.y = 1;
            this._tapJump = false;
        }
        deltas.move.append([v.x, v.y, v.z]);

        // rotate
        v.set(0, 0, 0);
        // single-touch orbit rotate (masked when there are 2+ touches)
        orbitRotate.set(touch[0], touch[1], 0);
        v.add(orbitRotate.mulScalar(orbit * (1 - double) * this.orbitSpeed * this.touchRotateSensitivity * DISPLACEMENT_SCALE));
        // single-touch fly / aerial look — aerial goes through this SAME path as
        // walk/fly (inverted drag + FOV-proportional sensitivity via orbitFactor)
        // so the drone view steers identically to walking.
        flyRotate.set(touch[0] * dragInvert, touch[1] * dragInvert, 0);
        v.add(flyRotate.mulScalar((fly + aerial) * (1 - double) * this.orbitSpeed * orbitFactor * this.touchRotateSensitivity * DISPLACEMENT_SCALE));
        deltas.rotate.append([v.x, v.y, v.z]);
    }
}

export { TouchDevice };
