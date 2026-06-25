import { KeyboardMouseSource, Vec3 } from 'playcanvas';

import { damp } from '../../core/math';
import type { Global } from '../../types';
import {
    DISPLACEMENT_SCALE,
    flipZForOrbit,
    screenToWorld
} from '../shared';
import type { CameraInputFrame, InputDevice, UpdateContext } from '../shared';

const tmpV1 = new Vec3();
const tmpV2 = new Vec3();
const keyMove = new Vec3();
const flyKeyVelocity = new Vec3();
const panMove = new Vec3();
const mouseRotate = new Vec3();
const wheelMove = new Vec3();

// Patch keydown / keyup so meta-key combinations don't leave keys stuck on
// macOS (the OS swallows keyup for any key released while Cmd is held).
const patchKeyboardMeta = (desktopInput: any) => {
    desktopInput._onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Meta') {
            desktopInput._keyNow.fill(0);
        } else if (!event.metaKey) {
            // Record the key level directly instead of delegating to the engine
            // handler. PlayCanvas's _onKeyDown early-returns (dropping the
            // press) whenever `_pointerLock` is true but the canvas does not
            // currently hold the OS pointer lock. Enabling gaming controls sets
            // `_pointerLock` true and requests pointer lock asynchronously, so
            // during the (frequent) windows where the lock isn't engaged the
            // press edge would be lost, leaving the held key recorded as
            // released. Recording directly keeps `_keyNow` an accurate physical
            // key-state regardless of pointer-lock timing. `_onKeyUp` is
            // ungated, so press/release stay symmetric; the pointer-lock
            // mouse-delta path (_onPointerMove) is untouched.
            event.stopPropagation();
            desktopInput._setKey(event.code, 1);
        }
    };

    const origOnKeyUp = desktopInput._onKeyUp;
    desktopInput._onKeyUp = (event: KeyboardEvent) => {
        if (event.key === 'Meta') {
            desktopInput._keyNow.fill(0);
        } else if (!event.metaKey) {
            origOnKeyUp(event);
        }
    };
};

class KeyboardMouseDevice implements InputDevice {
    moveSpeed: number = 4;

    orbitSpeed: number = 18;

    wheelSpeed: number = 0.06;

    mouseRotateSensitivity: number = 0.5;

    /**
     * Extra drag-look sensitivity multiplier in first-person (walk/fly) modes.
     * Without pointer lock you look around by dragging, and the trackpad/mouse
     * surface is finite — a low sensitivity forces long, repeated drags just to
     * turn. This boosts only the first-person look (orbit mode is unaffected)
     * so a single comfortable swipe covers a large turn. Tunable.
     */
    firstPersonLookSpeed: number = 3.0;

    /**
     * Walk-mode keyboard turn rate in degrees per second. A/D (and the
     * Left/Right arrows) yaw the view at this rate instead of strafing, so the
     * visitor turns with their movement like a real person walking a room.
     */
    walkTurnSpeed: number = 120;

    flyMoveAccelerationDamping: number = 0.992;

    flyMoveDecelerationDamping: number = 0.993;

    private _source: KeyboardMouseSource = new KeyboardMouseSource();

    private _global: Global | null = null;

    /** Running WASD/QE/arrow direction (sum of key states). */
    private _axis = new Vec3();

    /** Running button-held state per index: [LMB, MMB, RMB]. */
    private _buttons: [number, number, number] = [0, 0, 0];

    private _shift = 0;

    private _ctrl = 0;

    private _jump = 0;

    private _flyKeyVelocity = new Vec3();

    /**
     * Get the underlying source so other code (PointerLockManager) can
     * toggle its private pointer-lock flag, which gates how it consumes
     * mouse-delta events.
     *
     * @returns The PlayCanvas KeyboardMouseSource backing this device.
     */
    get source(): KeyboardMouseSource {
        return this._source;
    }

    attach(canvas: HTMLCanvasElement, global: Global): void {
        this._global = global;
        patchKeyboardMeta(this._source);
        this._source.attach(canvas);
    }

    detach(): void {
        // KeyboardMouseSource does not expose a detach; nothing to undo for
        // its DOM listeners here.
    }

    update(ctx: UpdateContext, frame: CameraInputFrame): void {
        const { keyCode } = KeyboardMouseSource;
        // read() is still called to consume mouse / wheel / button deltas and
        // advance the source, but the held-key state below is taken from the
        // source's current key *levels*, not the returned edge deltas.
        const { button, mouse, wheel } = this._source.read();
        const { events } = this._global!;

        // Read held-key state from the source's current key levels (`_keyNow`)
        // rather than accumulating edge deltas. Edge accumulation desyncs
        // permanently if any single press/release edge is missed (the
        // pointer-lock keydown gate, OS auto-repeat that emits keyup+keydown
        // pairs, the macOS Meta `_keyNow.fill(0)` clear, or window blur): a
        // still-held key then reads as released forever. That is what made WASD
        // forward motion silently stall and stutter while A/D turning — which
        // integrates into a persistent angle and so survived the dropouts —
        // stayed smooth. Level reads are self-healing: the state is always the
        // true physical key state every frame.
        const lvl = (this._source as any)._keyNow as number[];
        this._axis.set(
            (lvl[keyCode.D] - lvl[keyCode.A]) + (lvl[keyCode.RIGHT] - lvl[keyCode.LEFT]),
            (lvl[keyCode.E] - lvl[keyCode.Q]),
            (lvl[keyCode.W] - lvl[keyCode.S]) + (lvl[keyCode.UP] - lvl[keyCode.DOWN])
        );
        this._jump = lvl[keyCode.SPACE];
        this._shift = lvl[keyCode.SHIFT];
        this._ctrl = lvl[keyCode.CTRL];
        const n = Math.min(button.length, this._buttons.length);
        for (let i = 0; i < n; i++) {
            this._buttons[i] += button[i];
        }

        const { isFly, isWalk, isFirstPerson, gamingControls, dt, distance, cameraComponent, mode, touchCount } = ctx;
        const pan = this._buttons[2] || +(button[2] === -1) || +(touchCount > 1);

        // WASD/keyboard locomotion is fully disabled for this experience. The
        // only way to move is tap-to-go (turn-then-walk), which feels human and
        // keeps the controls clean. Holding this false kills all keyboard
        // movement, turning, and jump in every mode (walk, fly, drone).
        const keyboardMove = false;

        // auto-move cancellation and requestFirstPerson events (driven by keyboard axes)
        if (keyboardMove && isWalk && (this._axis.x !== 0 || this._axis.z !== 0)) {
            events.fire('navigateCancel');
        }
        if (keyboardMove && isFly && (this._axis.x !== 0 || this._axis.y !== 0 || this._axis.z !== 0)) {
            events.fire('navigateCancel');
        }
        if (isFly && wheel[0] !== 0) {
            events.fire('navigateCancel');
        }
        if (isFly && (gamingControls || pan) && (mouse[0] !== 0 || mouse[1] !== 0)) {
            events.fire('navigateCancel');
        }
        if (keyboardMove && !isFirstPerson && this._axis.length() > 0) {
            events.fire('inputEvent', 'requestFirstPerson');
        }

        // Drag-look sensitivity factor. First-person keeps the FOV-proportional
        // scaling (consistent feel across zoom) but adds a boost so looking
        // around by dragging doesn't require sweeping the whole trackpad.
        const lookFactor = isFirstPerson ? (cameraComponent.fov / 120) * this.firstPersonLookSpeed : 1;

        const { deltas } = frame;

        // move (WASD + mouse-drag pan + wheel)
        const v = tmpV1.set(0, 0, 0);
        keyMove.copy(this._axis);
        if (isWalk) {
            // Walk mode steers by turning, not strafing: the horizontal axis
            // (A/D, Left/Right) drives the view's yaw in the rotate section
            // below, so it must not contribute lateral movement here. Forward/
            // back (z) is the only locomotion axis. y is zeroed so jump doesn't
            // reduce horizontal speed.
            keyMove.x = 0;
            keyMove.y = 0;
        }
        keyMove.normalize();
        const shiftMul = isWalk ? 2 : 4;
        const ctrlMul = isWalk ? 0.5 : 0.25;
        const speed = this.moveSpeed * (this._shift ? shiftMul : this._ctrl ? ctrlMul : 1);
        keyMove.mulScalar(speed);
        if (isFly) {
            flyKeyVelocity.copy(keyMove);
            const damping = flyKeyVelocity.lengthSq() > this._flyKeyVelocity.lengthSq() ?
                this.flyMoveAccelerationDamping :
                this.flyMoveDecelerationDamping;
            this._flyKeyVelocity.lerp(this._flyKeyVelocity, flyKeyVelocity, damp(damping, dt));
            if (flyKeyVelocity.lengthSq() === 0 && this._flyKeyVelocity.lengthSq() < 1e-4) {
                this._flyKeyVelocity.set(0, 0, 0);
            }
            keyMove.copy(this._flyKeyVelocity);
        } else {
            this._flyKeyVelocity.set(0, 0, 0);
        }
        v.add(tmpV2.copy(keyMove).mulScalar((isFirstPerson && keyboardMove ? 1 : 0) * dt));
        if (isWalk && keyboardMove) {
            // Pass jump signal as raw Y; WalkController uses move[1] > 0 as
            // a boolean trigger.
            v.y = this._jump > 0 ? 1 : 0;
        }
        screenToWorld(cameraComponent, mouse[0], mouse[1], distance, panMove);
        v.add(panMove.mulScalar(pan));
        wheelMove.set(0, 0, -wheel[0]);
        v.add(wheelMove.mulScalar(this.wheelSpeed * DISPLACEMENT_SCALE));
        deltas.move.append([v.x, v.y, flipZForOrbit(mode, v.z)]);

        // rotate (mouse-drag, masked when in pan mode)
        v.set(0, 0, 0);
        mouseRotate.set(mouse[0], mouse[1], 0);
        v.add(mouseRotate.mulScalar((1 - pan) * this.orbitSpeed * lookFactor * this.mouseRotateSensitivity * DISPLACEMENT_SCALE));
        // Walk mode: A/D (and Left/Right arrows) turn the view rather than
        // strafe, so the visitor rotates with their movement. Sign matches
        // mouse-look (turning right = positive yaw delta); damping in the
        // controller smooths it into an even rotation.
        if (isWalk && keyboardMove) {
            v.x += this._axis.x * this.walkTurnSpeed * dt;
        }
        deltas.rotate.append([v.x, v.y, v.z]);
    }
}

export { KeyboardMouseDevice };
