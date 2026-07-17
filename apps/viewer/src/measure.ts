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
            events.fire('measureFirst');
        } else {
            b = p;          // second point -> complete the measurement
            if (global.config.debug && a) {
                // Authoring aid: log this pair ready to paste into settings.json
                // `calibration` (then set `meters` to the feature's real length).
                const r = (v: Vec3) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
                console.log('[measure] calibration reference:', JSON.stringify({ points: [r(a), r(b)], meters: +a.distance(b).toFixed(3) }));
            }
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
        state.measuring = on;        // block walking while measuring (look-around still works) — own flag, so the tutorial's moveLocked resets can't unlock walking mid-measurement
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

    // Authoring aid (console): probe the room around the current camera
    // position. Casts a horizontal ray fan at eye height plus one ray up and
    // one down, and logs the hit distances — the fastest way to read the real
    // room dimensions (spans through the camera) out of the calibrated scan
    // for a property's knowledge base. Not wired to any UI.
    (window as unknown as { probeRoom: (stepDeg?: number, origin?: number[]) => unknown }).probeRoom = (stepDeg = 5, origin?: number[]) => {
        if (!collision) {
            console.log('probeRoom: no collision data loaded');
            return null;
        }
        const cam = camera.camera!;
        const camPos = camera.getPosition();
        const pos = origin ? new Vec3(origin[0], origin[1], origin[2]) : camPos;
        const far = cam.farClip;
        const ray = (dx: number, dy: number, dz: number): number | null => {
            const hit = collision.queryRay(pos.x, pos.y, pos.z, dx, dy, dz, far);
            return hit ? +Math.hypot(hit.x - pos.x, hit.y - pos.y, hit.z - pos.z).toFixed(3) : null;
        };
        const fan: { deg: number; dist: number | null }[] = [];
        for (let deg = 0; deg < 360; deg += stepDeg) {
            const rad = (deg * Math.PI) / 180;
            fan.push({ deg, dist: ray(Math.cos(rad), 0, Math.sin(rad)) });
        }
        // Opposite-ray pairs -> straight spans through the camera position.
        const spans = fan
        .filter(f => f.deg < 180 && f.dist !== null)
        .map((f) => {
            const opposite = fan.find(o => o.deg === f.deg + 180);
            return opposite?.dist != null ?
                { deg: f.deg, span: +(f.dist! + opposite.dist).toFixed(3) } :
                null;
        })
        .filter((s): s is { deg: number; span: number } => s !== null);
        const up = ray(0, 1, 0);
        const down = ray(0, -1, 0);
        const result = {
            position: [+pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3)],
            floorToCeiling: up !== null && down !== null ? +(up + down).toFixed(3) : null,
            up,
            down,
            spans,
            fan
        };
        console.log(`probeRoom →\n${JSON.stringify(result)}`);
        return result;
    };

    // Authoring aid (console): build a ready-to-paste `settings.rooms[]` entry
    // for the room around the current camera position (see room-dimensions.ts).
    // Uses the probeRoom ray fan: the widest reliable span becomes the length
    // axis, its perpendicular the width axis, and the three dimension lines are
    // laid along the floor at the base of the far walls plus one vertical line
    // in the far corner. `maxSpan` guards against rays escaping through open
    // doors/windows (default 15 m). The result is a STARTING POINT — verify it
    // visually in measure mode and nudge the points where the scan is irregular.
    (window as unknown as { roomEntry: (name?: string, stepDeg?: number, maxSpan?: number, origin?: number[]) => unknown }).roomEntry = (name = 'Raum', stepDeg = 5, maxSpan = 15, origin?: number[]) => {
        const probe = (window as unknown as { probeRoom: (stepDeg?: number, origin?: number[]) => any }).probeRoom(stepDeg, origin);
        if (!probe || probe.up === null || probe.down === null) {
            console.log('roomEntry: no floor/ceiling hit — stand inside the room');
            return null;
        }
        const pos = probe.position as number[];
        const fan = probe.fan as { deg: number, dist: number | null }[];
        const at = (deg: number) => fan.find(f => f.deg === ((deg % 360) + 360) % 360)?.dist ?? null;
        // The SMALLEST span is the wall-to-wall width, i.e. it runs perpendicular
        // to the long walls — the widest span would be the room's diagonal and
        // mis-align every line. Both its rays and both perpendicular rays must
        // hit within maxSpan (guards against escapes through open doors/windows).
        let best: { deg: number, span: number } | null = null;
        for (const s of probe.spans as { deg: number, span: number }[]) {
            if (s.span > maxSpan) continue;
            const perp = [at(s.deg + 90), at(s.deg + 270)];
            if (perp.some(d => d === null || d! > maxSpan)) continue;
            if (!best || s.span < best.span) best = s;
        }
        if (!best) {
            console.log('roomEntry: no reliable span — try a different spot or a larger maxSpan');
            return null;
        }
        const rad = (best.deg * Math.PI) / 180;
        const v = [Math.cos(rad), Math.sin(rad)];                  // width axis (x, z)
        const u = [Math.cos(rad + Math.PI / 2), Math.sin(rad + Math.PI / 2)];   // length axis
        const dW1 = at(best.deg)!;
        const dW2 = at(best.deg + 180)!;
        const dL1 = at(best.deg + 90)!;
        const dL2 = at(best.deg + 270)!;
        const floorY = pos[1] - probe.down + 0.04;                 // just above the floor
        const height = probe.up + probe.down;
        const p = (x: number, y: number, z: number) => [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)];
        // The four floor corners of the room rectangle — the perimeter lines
        // share them exactly, so the frame is CLOSED (lines meet in the
        // corners instead of stopping short of them).
        const corner = (sL: number, sW: number) => {
            const dL = sL > 0 ? dL1 : dL2;
            const dW = sW > 0 ? dW1 : dW2;
            return { x: pos[0] + u[0] * dL * sL + v[0] * dW * sW, z: pos[2] + u[1] * dL * sL + v[1] * dW * sW };
        };
        const ff = corner(1, 1);     // far/far — the height line stands here
        const fn = corner(1, -1);
        const nf = corner(-1, 1);
        const nn = corner(-1, -1);
        const entry = {
            name,
            center: p(pos[0], pos[1], pos[2]),
            area: +((dL1 + dL2) * (dW1 + dW2)).toFixed(1),
            lines: [
                { a: p(nf.x, floorY, nf.z), b: p(ff.x, floorY, ff.z) },   // length, far side wall
                { a: p(nn.x, floorY, nn.z), b: p(fn.x, floorY, fn.z) },   // length, near side wall
                { a: p(fn.x, floorY, fn.z), b: p(ff.x, floorY, ff.z) },   // width, far end wall
                { a: p(nn.x, floorY, nn.z), b: p(nf.x, floorY, nf.z) },   // width, near end wall
                { a: p(ff.x, floorY, ff.z), b: p(ff.x, floorY + height - 0.08, ff.z) }   // ceiling height, far corner
            ]
        };
        console.log(`roomEntry →\n${JSON.stringify(entry)}`);
        return entry;
    };
};

export { initMeasure, formatLength };
