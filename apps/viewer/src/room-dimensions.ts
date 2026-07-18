import { Vec3 } from 'playcanvas';

import { formatLength } from './measure';
import type { Global } from './types';

const tmpView = new Vec3();
const tmpA = new Vec3();
const tmpB = new Vec3();

type Tuple3 = [number, number, number];
type RoomLine = { a: Tuple3, b: Tuple3 };
type RoomSettings = {
    name: string,
    center: Tuple3,
    lines: RoomLine[],
    area?: number
};

// Authored room dimensions ("Raummaße"). In the bird's-eye view (aerial mode)
// every authored room presents its dimensions by itself: solid hairlines
// along the wall bases with metric length labels — the floor-plan moment.
// Deliberately NOT shown in walk mode: down there the ruler button is the
// visitor's own two-point measurement, and mixing both reads as noise. Data
// comes from settings.rooms, authored once per property from the calibrated
// scan (console helper roomEntry() in measure.ts), so the numbers are curated,
// never guessed live. Own overlay (#roomDimsOverlay, below #measureOverlay):
// the measure overlay's visibility tracks measure mode, not the camera mode.
const initRoomDimensions = (global: Global) => {
    const { app, events, settings, state, camera } = global;

    const rooms = (Array.isArray(settings.rooms) ? settings.rooms : [])
    .filter((r: RoomSettings) => r?.name && Array.isArray(r.center) &&
            Array.isArray(r.lines) && r.lines.length > 0);
    if (rooms.length === 0) return;

    const measureOverlay = document.getElementById('measureOverlay');
    if (!measureOverlay?.parentElement) return;

    // Own overlay, inserted BELOW the measure overlay so a manual measurement
    // (if ever shown together) always draws on top.
    const overlay = document.createElement('div');
    overlay.id = 'roomDimsOverlay';
    overlay.classList.add('hidden');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('measure__svg');
    overlay.appendChild(svg);
    measureOverlay.parentElement.insertBefore(overlay, measureOverlay);

    let active = false;
    const lineEls: SVGLineElement[] = [];
    const labelEls: HTMLDivElement[] = [];
    // Flat list over ALL rooms — the bird's-eye view shows the whole floor.
    const allLines: RoomLine[] = rooms.flatMap((r: RoomSettings) => r.lines);

    // View-space depth (negative = in front of the camera).
    const viewZ = (p: Vec3): number => {
        camera.camera!.viewMatrix.transformPoint(p, tmpView);
        return tmpView.z;
    };

    const project = (p: Vec3): { x: number, y: number } => {
        const s = camera.camera!.worldToScreen(p);
        return { x: s.x, y: s.y };
    };

    const lineLength = (l: RoomLine): number => {
        tmpA.set(l.a[0], l.a[1], l.a[2]);
        tmpB.set(l.b[0], l.b[1], l.b[2]);
        return tmpA.distance(tmpB);
    };

    const build = () => {
        for (let i = 0; i < allLines.length; i++) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.classList.add('measure__line', 'roomDims__line');
            svg.appendChild(line);
            lineEls.push(line);
            const label = document.createElement('div');
            label.className = 'measure__label roomDims__label';
            overlay.appendChild(label);
            labelEls.push(label);
        }
    };

    const render = () => {
        if (!active) return;

        allLines.forEach((l: RoomLine, i: number) => {
            tmpA.set(l.a[0], l.a[1], l.a[2]);
            tmpB.set(l.b[0], l.b[1], l.b[2]);
            // A room-sized line can have one end behind the camera during the
            // glide into the bird's-eye pose — clip it at the camera plane
            // instead of hiding it, so the visible part keeps showing.
            const EPS = -0.05;
            const za = viewZ(tmpA);
            const zb = viewZ(tmpB);
            if (za >= EPS && zb >= EPS) {
                lineEls[i].classList.add('hidden');
                labelEls[i].classList.add('hidden');
                return;
            }
            if (za >= EPS) {
                tmpA.lerp(tmpA, tmpB, (za - EPS) / (za - zb));
            } else if (zb >= EPS) {
                tmpB.lerp(tmpB, tmpA, (zb - EPS) / (zb - za));
            }
            const sa = project(tmpA);
            const sb = project(tmpB);
            lineEls[i].classList.remove('hidden');
            lineEls[i].setAttribute('x1', `${sa.x}`);
            lineEls[i].setAttribute('y1', `${sa.y}`);
            lineEls[i].setAttribute('x2', `${sb.x}`);
            lineEls[i].setAttribute('y2', `${sb.y}`);
            labelEls[i].classList.remove('hidden');
            labelEls[i].textContent = formatLength(lineLength(l));
            labelEls[i].style.left = `${(sa.x + sb.x) / 2}px`;
            labelEls[i].style.top = `${(sa.y + sb.y) / 2}px`;
        });
    };

    app.on('update', render);

    // Visible exactly while the camera is in a top-down context — the
    // bird's-eye mode and the dollhouse model (including the glide in/out —
    // the lines settle with the camera).
    const update = () => {
        const on = state.cameraMode === 'aerial' || state.cameraMode === 'dollhouse';
        if (on === active) return;
        active = on;
        overlay.classList.toggle('hidden', !on);
        if (on) {
            if (lineEls.length === 0) build();
            render();
            app.renderNextFrame = true;
        } else {
            lineEls.forEach(el => el.classList.add('hidden'));
            labelEls.forEach(el => el.classList.add('hidden'));
        }
    };

    events.on('cameraMode:changed', update);
    update();
};

export { initRoomDimensions };
