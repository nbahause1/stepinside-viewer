import { math, Vec3 } from 'playcanvas';

import type { Camera, CameraController, CameraFrame } from './camera';
import { DEFAULT_CONTROLLER_DAMPING, applyFrameRotation, dampAngles } from './camera-utils';

// Fixed-vantage "bird's-eye" controller. The camera holds its position; the
// visitor only looks around (drag) and zooms optically (wheel / pinch -> FOV).
// Keeping the position locked means the high overview never drifts off into the
// scan's sparse exterior, and "zoom" never moves the camera.
const MIN_FOV = 38;
const MAX_FOV = 100;
const ZOOM_SENSITIVITY = 42;   // maps the wheel/pinch delta (move.z) to degrees of FOV

class AerialController implements CameraController {
    fov = 90;

    rotateDamping = DEFAULT_CONTROLLER_DAMPING;

    private _position = new Vec3();

    private _angles = new Vec3();

    private _targetAngles = new Vec3();

    private _distance = 1;

    onEnter(camera: Camera): void {
        this.goto(camera);
    }

    goto(camera: Camera): void {
        this._position.copy(camera.position);
        this._angles.set(camera.angles.x, camera.angles.y, 0);
        this._targetAngles.copy(this._angles);
        this._distance = camera.distance;
        this.fov = camera.fov;
    }

    update(deltaTime: number, inputFrame: CameraFrame, camera: Camera): void {
        const { move, rotate } = inputFrame.read();

        // drag = look around in place (pitch clamped so the view can't flip over)
        applyFrameRotation(this._targetAngles, rotate, -88, 88);
        dampAngles(this._angles, this._targetAngles, this.rotateDamping, deltaTime);

        // wheel / pinch arrives as move.z; map it to optical FOV zoom (position stays put)
        if (move[2]) {
            this.fov = math.clamp(this.fov - move[2] * ZOOM_SENSITIVITY, MIN_FOV, MAX_FOV);
        }

        camera.position.copy(this._position);
        camera.angles.set(this._angles.x, this._angles.y, 0);
        camera.distance = this._distance;
        camera.fov = this.fov;
    }

    onExit(_camera: Camera): void {
        // nothing to tear down
    }
}

export { AerialController };
