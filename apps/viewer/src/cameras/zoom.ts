import { math } from 'playcanvas';

// Optical zoom for the first-person modes (walk/fly): a shared zoom factor
// that narrows the camera FOV like a lens, NOT a dolly. Input devices set the
// target (pinch on touch, wheel on desktop); the controllers apply it with
// exponential smoothing every frame, so zooming always eases like the rest of
// the camera motion.
//
// The FOV transform is tan-true (fov' = 2·atan(tan(fov/2)/zoom)) so 2× zoom
// really doubles the apparent size of what's in the centre of the view.
//
// Module-level singleton on purpose: the camera controllers are constructed
// without access to Global (see camera-manager.ts), and there is exactly one
// camera. Interested parties (resolution scaling, the zoom badge) register a
// notifier that forwards changes onto the global event bus.

const ZOOM_MIN = 1;
const ZOOM_MAX = 2.5;

/** How fast the smoothed zoom eases toward the target (higher = snappier). */
const SMOOTHING_RATE = 12;

const zoomState = {
    target: 1,
    smoothed: 1
};

let notify: ((zoom: number) => void) | null = null;

/**
 * Forward zoom-target changes (e.g. onto the global event bus as 'zoom:changed').
 * @param fn
 */
const registerZoomNotifier = (fn: (zoom: number) => void) => {
    notify = fn;
};

const getZoom = () => zoomState.target;

const setZoom = (value: number) => {
    const clamped = math.clamp(value, ZOOM_MIN, ZOOM_MAX);
    if (clamped === zoomState.target) return;
    zoomState.target = clamped;
    notify?.(clamped);
};

/**
 * Multiplicative step — the natural unit for pinch/wheel gestures.
 * @param factor
 */
const multiplyZoom = (factor: number) => setZoom(zoomState.target * factor);

/**
 * Ease back to 1× (used when the camera mode changes).
 * @param immediate
 */
const resetZoom = (immediate = false) => {
    setZoom(1);
    if (immediate) zoomState.smoothed = 1;
};

/**
 * Advance the smoothed zoom by dt and return the zoomed FOV for this frame.
 * Called by the walk/fly controllers exactly where they write camera.fov.
 * @param baseFovDeg
 * @param dt
 */
const applySmoothedZoom = (baseFovDeg: number, dt: number): number => {
    const t = 1 - Math.exp(-dt * SMOOTHING_RATE);
    zoomState.smoothed += (zoomState.target - zoomState.smoothed) * t;
    if (Math.abs(zoomState.smoothed - zoomState.target) < 1e-3) {
        zoomState.smoothed = zoomState.target;
    }
    if (zoomState.smoothed === 1) return baseFovDeg;
    const halfTan = Math.tan(baseFovDeg * 0.5 * math.DEG_TO_RAD) / zoomState.smoothed;
    return 2 * Math.atan(halfTan) * math.RAD_TO_DEG;
};

export { registerZoomNotifier, getZoom, setZoom, multiplyZoom, resetZoom, applySmoothedZoom, ZOOM_MAX };
