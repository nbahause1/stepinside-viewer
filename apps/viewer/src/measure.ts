import { Vec3 } from 'playcanvas';

import { IdleLook } from './cameras/idle-look';
import type { Collision } from './collision';
import type { Picker } from './picker';
import type { Global } from './types';

const tmpDir = new Vec3();
const tmpView = new Vec3();

// German units: "2,34 m" at/above a metre, "84 cm" below — comma decimal.
const formatLength = (metres: number): string => {
    if (metres < 1) {
        return `${Math.round(metres * 100)} cm`;
    }
    return `${metres.toFixed(2).replace('.', ',')} m`;
};

// Distance measurement: tap two surface points and read the metric length
// between them, drawn as a dashed line + label that stays attached as the camera
// moves. Picking reuses the collision ray (the same one click-to-walk uses), so
// the points snap to the real splat surface; the scene is metric, so the length
// is true-to-life.
const initMeasure = (global: Global, _picker: Picker, collision: Collision | null) => {
    const { app, events, state, camera } = global;
    const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;

    const overlay = document.getElementById('measureOverlay');
    const line = document.getElementById('measureLine');
    const dotA = document.getElementById('measureDotA');
    const dotB = document.getElementById('measureDotB');
    const dotPreview = document.getElementById('measureDotPreview');
    const label = document.getElementById('measureLabel');
    if (!overlay || !line || !dotA || !dotB || !dotPreview || !label) return;

    let active = false;
    let a: Vec3 | null = null;
    let b: Vec3 | null = null;
    let preview: Vec3 | null = null;

    // Surface point under a canvas pixel via the collision ray; null on a miss
    // (e.g. the ray goes out of a window).
    const pick = (offsetX: number, offsetY: number): Vec3 | null => {
        if (!collision) return null;
        const cam = camera.camera!;
        const camPos = camera.getPosition();
        cam.screenToWorld(offsetX, offsetY, 1.0, tmpDir);
        tmpDir.sub(camPos).normalize();
        const hit = collision.queryRay(
            camPos.x, camPos.y, camPos.z,
            tmpDir.x, tmpDir.y, tmpDir.z,
            cam.farClip
        );
        return hit ? new Vec3(hit.x, hit.y, hit.z) : null;
    };

    // World -> screen px, or null when the point is behind the camera.
    const project = (p: Vec3): { x: number; y: number } | null => {
        const cam = camera.camera!;
        cam.viewMatrix.transformPoint(p, tmpView);
        if (tmpView.z >= 0) {
            return null;
        }
        const s = cam.worldToScreen(p);
        return { x: s.x, y: s.y };
    };

    const placeDot = (el: HTMLElement, p: Vec3 | null): { x: number; y: number } | null => {
        const s = p ? project(p) : null;
        if (!s) {
            el.classList.add('hidden');
            return null;
        }
        el.classList.remove('hidden');
        el.style.left = `${s.x}px`;
        el.style.top = `${s.y}px`;
        return s;
    };

    const render = () => {
        if (!active) return;

        const sa = placeDot(dotA, a);
        const end = b ?? preview;
        const sb = placeDot(b ? dotB : dotPreview, end);
        (b ? dotPreview : dotB).classList.add('hidden');

        if (sa && sb && a && end) {
            line.classList.remove('hidden');
            line.setAttribute('x1', `${sa.x}`);
            line.setAttribute('y1', `${sa.y}`);
            line.setAttribute('x2', `${sb.x}`);
            line.setAttribute('y2', `${sb.y}`);

            label.textContent = formatLength(a.distance(end));
            label.classList.remove('hidden');
            label.style.left = `${(sa.x + sb.x) / 2}px`;
            label.style.top = `${(sa.y + sb.y) / 2}px`;
        } else {
            line.classList.add('hidden');
            label.classList.add('hidden');
        }
    };

    app.on('update', render);

    // --- input (only while active) ---
    let downX = 0;
    let downY = 0;

    const onDown = (e: PointerEvent) => {
        if (active) {
            downX = e.offsetX;
            downY = e.offsetY;
        }
    };

    const onMove = (e: PointerEvent) => {
        if (!active || b) return;            // no live preview once the pair is set
        const p = pick(e.offsetX, e.offsetY);
        if (p) preview = p;
    };

    const onUp = (e: PointerEvent) => {
        if (!active) return;
        // distinguish a tap (place point) from a drag (look around)
        if (Math.hypot(e.offsetX - downX, e.offsetY - downY) > 6) return;
        const p = pick(e.offsetX, e.offsetY);
        if (!p) return;
        if (!a || b) {
            a = p;          // first point, or restart after a finished measurement
            b = null;
            preview = p;
        } else {
            b = p;          // second point -> complete the measurement
            events.fire('measureComplete');
        }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);

    const setActive = (on: boolean) => {
        if (on === active) return;
        active = on;
        a = null;
        b = null;
        preview = null;
        state.moveLocked = on;       // block walking while measuring (look-around still works)
        IdleLook.suppressed = on;    // hold the camera still — no idle wander while measuring
        document.body.classList.toggle('measure-active', on);
        overlay.classList.toggle('hidden', !on);
        if (!on) {
            [line, dotA, dotB, dotPreview, label].forEach(el => el.classList.add('hidden'));
        }
        events.fire('measureActive', on);   // onboarding listens to drive its measure step
    };

    events.on('inputEvent', (name: string) => {
        if (name === 'measure') {
            setActive(!active);
        } else if (name === 'aerial' || name === 'reset' || name === 'frame') {
            setActive(false);       // leave measure mode on any camera change
        }
    });
};

export { initMeasure };
