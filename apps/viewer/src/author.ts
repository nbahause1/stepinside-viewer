import { Vec3 } from 'playcanvas';

import { IdleLook } from './cameras/idle-look';
import type { Collision } from './collision';
import type { Global } from './types';


// Author mode ("?author") — the Studio's in-viewer authoring loop. NEVER for
// visitors: viewer.ts dynamic-imports this module only when config.author is
// set (same pattern as the tour-generator devtools import, so these lines never
// reach the visitor bundle either).
//
// Two authoring actions, both writing into local working copies of
// settings.rooms / settings.annotations:
//   Highlight setzen — frame the view you want visitors to see, then press:
//                      the CURRENT pose is captured exactly (position = where
//                      you stand, target = the surface point in the centre of
//                      your view via the collision ray). The marker sits on
//                      that centre point; the fly-to camera reproduces your
//                      framing 1:1. No clicking in the scene.
// Speichern POSTs the FULL arrays to the Studio's /save-settings (replace
// semantics — the nameless dollhouse-footprint entry from the pipeline is in
// the working copy, so it survives every save), then reloads for review.
const initAuthor = (global: Global, collision: Collision | null) => {
    const { config, state, camera, events } = global;

    // The save target is derivable only from a Studio asset URL (?assets=/out/<pid>/<version>)
    const m = (config.assets ?? '').match(/^\/out\/([a-z0-9-]{1,64})\/(v\d+)$/);
    const target = m ? { pid: m[1], version: m[2] } : null;

    // Working copies — replace-array semantics on save.
    const rooms: any[] = Array.isArray(global.settings.rooms) ? [...(global.settings.rooms as any[])] : [];
    const annotations: any[] = Array.isArray(global.settings.annotations) ? [...(global.settings.annotations as any[])] : [];
    const seats: any[] = Array.isArray((global.settings as any).seats) ? [...((global.settings as any).seats as any[])] : [];
    // Drone views. The pipeline derives a default set (one oblique bird's-eye
    // per room); authoring REPLACES that array, so whatever is listed here is
    // exactly what the visitor gets.
    const aerials: any[] = Array.isArray((global.settings as any).aerialViews) ? [...((global.settings as any).aerialViews as any[])] : [];
    let dirty = false;


    // --- UI (self-contained, injected — the debug panel does the same) ------
    const style = document.createElement('style');
    style.textContent = `
#authorBar { position: fixed; top: 12px; right: 12px; z-index: 60; width: 240px;
  background: rgba(12,14,20,.92); border: 1px solid rgba(255,255,255,.14); border-radius: 14px;
  padding: 12px; font: 12.5px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: #e7e9ee; backdrop-filter: blur(14px); }
#authorBar h3 { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: #8b90a0; margin: 0 0 8px; }
#authorBar button { display: block; width: 100%; margin-top: 6px; padding: 8px 10px; border: 0;
  border-radius: 9px; background: rgba(110,168,254,.18); color: #b9d1ff; font-weight: 600;
  font-size: 12.5px; cursor: pointer; }
#authorBar button:hover { background: rgba(110,168,254,.3); }
#authorBar button.save { background: #34c778; color: #04140b; }
#authorBar button.save:disabled { opacity: .4; cursor: not-allowed; }
#authorBar button.final { background: rgba(255,255,255,.14); color: #fff; }
#authorBar button.final:hover { background: rgba(255,255,255,.24); }
#authorBar button.final:disabled { opacity: .4; cursor: not-allowed; }
#authorBar .entries { margin-top: 8px; max-height: 30vh; overflow-y: auto; }
#authorBar .entry { display: flex; justify-content: space-between; align-items: center;
  padding: 4px 6px; border-radius: 6px; background: rgba(255,255,255,.05); margin-top: 4px; }
#authorBar .entry .x { cursor: pointer; color: #f1734f; font-weight: 700; padding: 0 4px; }
#authorBar .hintline { margin-top: 8px; color: #8b90a0; font-size: 11.5px; min-height: 15px; }
`;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'authorBar';
    bar.innerHTML = `
        <h3>Autoren-Modus</h3>
        <button data-id="highlight">📍 Highlight: diese Ansicht</button>
        <button data-id="seat">🪑 Sitz setzen</button>
        <button data-id="fly">🚁 Freie Drohne</button>
        <button data-id="aerial">🚁 Drohnenansicht: diese Perspektive</button>
        <button data-id="save" class="save">Speichern</button>
        <button data-id="final" class="final">✅ Fertigstellen &amp; ins Repo</button>
        <div class="entries" data-id="entries"></div>
        <div class="hintline" data-id="hint"></div>`;
    document.body.appendChild(bar);

    const btnHighlight = bar.querySelector('[data-id="highlight"]') as HTMLButtonElement;
    const btnSeat = bar.querySelector('[data-id="seat"]') as HTMLButtonElement;
    const btnFly = bar.querySelector('[data-id="fly"]') as HTMLButtonElement;
    const btnAerial = bar.querySelector('[data-id="aerial"]') as HTMLButtonElement;
    const btnSave = bar.querySelector('[data-id="save"]') as HTMLButtonElement;
    const btnFinal = bar.querySelector('[data-id="final"]') as HTMLButtonElement;
    const entriesEl = bar.querySelector('[data-id="entries"]') as HTMLDivElement;
    const hintEl = bar.querySelector('[data-id="hint"]') as HTMLDivElement;

    const hint = (t: string) => { hintEl.textContent = t; };

    const render = () => {
        entriesEl.textContent = '';
        const add = (label: string, onRemove: () => void) => {
            const div = document.createElement('div');
            div.className = 'entry';
            const span = document.createElement('span');
            span.textContent = label;
            const x = document.createElement('span');
            x.className = 'x';
            x.textContent = '✕';
            x.onclick = () => { onRemove(); dirty = true; render(); };
            div.append(span, x);
            entriesEl.appendChild(div);
        };
        // named rooms only — the pipeline's nameless dollhouse footprint stays out of sight
        rooms.forEach((r, i) => { if (r?.name) add(`📐 ${r.name}`, () => rooms.splice(i, 1)); });
        annotations.forEach((a, i) => add(`📍 ${a.title}`, () => annotations.splice(i, 1)));
        seats.forEach((st, i) => add(`🪑 Sitz ${i + 1}`, () => seats.splice(i, 1)));
        aerials.forEach((a, i) => add(`🚁 Drohne ${i + 1}`, () => aerials.splice(i, 1)));
        btnSave.textContent = dirty ? 'Speichern ✓' : 'Speichern';
        btnSave.disabled = !target || !dirty;
        btnFinal.disabled = !target;
    };

    if (!target) hint('Speichern nur im Studio-Preview möglich (/out/…-Asset-URL).');

    // --- Highlight setzen: capture the CURRENT view exactly ----------------
    // The author frames the shot first (walks + looks), then presses the
    // button. Position = camera, gaze = the entity's forward (this includes
    // the walk-mode gaze offsets — it is literally what is on screen). The
    // marker/target sits where the centre of the view hits a surface
    // (collision ray); if the centre ray escapes (window/open door), fall
    // back to a point 3 m along the gaze so the capture never fails.
    const tmpDir = new Vec3();

    const centreOfView = (): Vec3 => {
        const cam = camera.camera!;
        const camPos = camera.getPosition();
        tmpDir.copy(camera.forward).normalize();
        if (collision) {
            const hit = collision.queryRay(
                camPos.x, camPos.y, camPos.z,
                tmpDir.x, tmpDir.y, tmpDir.z,
                cam.farClip
            );
            if (hit) return new Vec3(hit.x, hit.y, hit.z);
        }
        return new Vec3(
            camPos.x + tmpDir.x * 3,
            camPos.y + tmpDir.y * 3,
            camPos.z + tmpDir.z * 3
        );
    };

    btnHighlight.onclick = () => {
        // hold everything still while the prompts are open, so the captured
        // pose IS the framed pose (no idle wander between press and confirm)
        state.measuring = true;
        IdleLook.suppressed = true;
        const cam = camera.camera!;
        const c = camera.getPosition().clone();
        const fov = cam.fov;
        const p = centreOfView();
        const title = window.prompt('Titel des Highlights:');
        if (!title) {
            state.measuring = false;
            IdleLook.suppressed = false;
            hint('');
            return;
        }
        const text = window.prompt('Beschreibung (kurz):') ?? '';
        state.measuring = false;
        IdleLook.suppressed = false;
        annotations.push({
            position: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
            title,
            text,
            // fly-to pose: EXACTLY the authored framing — visitors see what you saw
            camera: { initial: {
                position: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)],
                target: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
                fov
            } }
        });
        dirty = true;
        render();
        hint(`„${title}" gesetzt — exakt diese Ansicht. Weiter oder speichern.`);
    };

    // --- Freie Drohne: der Weg IN den freien Flug --------------------------
    // The free fly camera is reachable only through the number keys, and only
    // with ?debug/?scout — undiscoverable, and useless here: framing a drone
    // view is the one job that requires it. So the author bar carries the
    // switch itself. It is not a viewer feature; the bar only exists in
    // authoring, so visitors still never reach the free camera.
    const syncFlyBtn = () => {
        const flying = state.cameraMode === 'fly';
        btnFly.textContent = flying ? '🚶 Zurück ins Gehen' : '🚁 Freie Drohne';
    };

    btnFly.onclick = () => {
        const flying = state.cameraMode === 'fly';
        state.cameraMode = flying ? 'walk' : 'fly';
        syncFlyBtn();
        hint(flying ?
            'Gehen. Maus ziehen = umsehen, Klick = hinlaufen.' :
            'Freie Drohne. Ziehen = umsehen, Mausrad = vor/zurück, Hochstelltaste = schneller.');
    };

    // stay in sync when the mode changes elsewhere (number keys, toolbar, Esc)
    events.on('cameraMode:changed', syncFlyBtn);
    syncFlyBtn();

    // --- Drohnenansicht setzen: die aktuelle Perspektive festhalten ---------
    // Same act as a highlight — fly (2 = free camera) until the framing is
    // right, then press — but stored as `settings.aerialViews[]`, the fixed
    // bird's-eye set the viewer offers instead of as a narrative annotation.
    // So: no title, no description, no marker in the room; just the pose.
    //
    // The pipeline pre-fills this array (one oblique view per detected room).
    // Authoring replaces it wholesale, which is what makes it useful: the
    // derived views are a starting point, not a constraint.
    btnAerial.onclick = () => {
        // freeze the pose while capturing, exactly as the highlight does — an
        // idle wander between press and store would falsify the framing
        state.measuring = true;
        IdleLook.suppressed = true;
        const cam = camera.camera!;
        const c = camera.getPosition().clone();
        const p = centreOfView();
        const fov = cam.fov;
        state.measuring = false;
        IdleLook.suppressed = false;
        aerials.push({
            position: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)],
            target: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
            fov
        });
        dirty = true;
        render();
        hint(`Drohnenansicht ${aerials.length} gesetzt — exakt diese Perspektive. Weiter oder speichern.`);
    };

    // --- Sitz setzen: Klick auf die Sitzfläche pinnt den Sitz ---------------
    // yaw zeigt vom Sitz ZUM Autor: wer den Sitz pinnt, steht naturgemäß dort,
    // wo der Sitzende später hinschauen soll (vor dem Sofa, im Raum).
    let seatPicking = false;
    let seatDownX = 0, seatDownY = 0;
    const seatTmpDir = new Vec3();

    const pickSurface = (offsetX: number, offsetY: number): Vec3 | null => {
        if (!collision) return null;
        const cam = camera.camera!;
        const camPos = camera.getPosition();
        cam.screenToWorld(offsetX, offsetY, 1.0, seatTmpDir);
        seatTmpDir.sub(camPos).normalize();
        const hit = collision.queryRay(camPos.x, camPos.y, camPos.z, seatTmpDir.x, seatTmpDir.y, seatTmpDir.z, cam.farClip);
        return hit ? new Vec3(hit.x, hit.y, hit.z) : null;
    };

    btnSeat.onclick = () => {
        if (seatPicking) { seatPicking = false; state.measuring = false; hint(''); return; }
        seatPicking = true;
        state.measuring = true;         // Click-to-walk aus, solange gepinnt wird
        hint('Klicke auf die SITZFLÄCHE (Sofa/Stuhl) …');
    };
    const canvasEl = global.app.graphicsDevice.canvas as HTMLCanvasElement;
    canvasEl.addEventListener('pointerdown', (e) => {
        if (seatPicking) { seatDownX = e.offsetX; seatDownY = e.offsetY; }
    });
    canvasEl.addEventListener('pointerup', (e) => {
        if (!seatPicking) return;
        if (Math.hypot(e.offsetX - seatDownX, e.offsetY - seatDownY) > 4) return;   // Drag = Umschauen
        let hit = pickSurface(e.offsetX, e.offsetY);
        if (!hit) { hint('Kein Treffer, klicke direkt auf die Sitzfläche.'); return; }
        // Der Klick-Strahl kann durch ein Loch im Kollisions-Voxel HINTER die
        // sichtbare Fläche fallen (z.B. in den Hohlraum unter dem Boden).
        // Darum wird die Stelle von OBEN nachgetastet: der erste Treffer von
        // oben ist die echte Oberfläche (Sofa-Sitzfläche), nie das Loch.
        if (collision) {
            const top = collision.queryRay(hit.x, hit.y + 1.4, hit.z, 0, -1, 0, 3);
            if (top && top.y > hit.y + 0.05) hit = new Vec3(top.x, top.y, top.z);
        }
        const c = camera.getPosition();
        const yawDeg = Math.round(Math.atan2(-(c.x - hit.x), -(c.z - hit.z)) * 180 / Math.PI);
        seats.push({ position: [+hit.x.toFixed(2), +hit.y.toFixed(2), +hit.z.toFixed(2)], yaw: yawDeg });
        seatPicking = false;
        state.measuring = false;
        dirty = true;
        render();
        hint(`Sitz ${seats.length} gepinnt (blickt zu deinem Standpunkt). Weiter oder speichern.`);
    });

    // --- Speichern: replace-array POST to the Studio, then reload for review -
    btnSave.onclick = async () => {
        if (!target) return;
        btnSave.disabled = true;
        hint('Speichere …');
        try {
            const res = await fetch('/save-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pid: target.pid, version: target.version, rooms, annotations, seats, aerialViews: aerials })
            });
            if (!res.ok) throw new Error(await res.text());
            hint('Gespeichert — lade neu zur Kontrolle …');
            window.location.reload();
        } catch (err) {
            hint(`Fehler: ${(err as Error).message}`);
            btnSave.disabled = false;
        }
    };

    // --- Fertigstellen: speichern UND ins Repo übernehmen ------------------
    // "Speichern" writes settings.json inside dist/onboard — which is
    // git-ignored, so the work exists on this machine only. Finalising copies
    // the whole asset set to apps/website/public/tours/<pid>, where git sees it
    // and Vercel can serve it. Without this step an authored scan quietly dies
    // with its dist folder; that has happened once already.
    btnFinal.onclick = async () => {
        if (!target) return;
        btnFinal.disabled = true;
        btnSave.disabled = true;
        try {
            if (dirty) {
                hint('Speichere …');
                const save = await fetch('/save-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pid: target.pid, version: target.version, rooms, annotations, seats, aerialViews: aerials })
                });
                if (!save.ok) throw new Error(await save.text());
                dirty = false;
            }
            hint('Übernehme ins Repo … (kann bei großen Scans dauern)');
            const res = await fetch('/finalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pid: target.pid, version: target.version })
            });
            if (!res.ok) throw new Error(await res.text());
            const out = await res.json();
            hint(`Fertig — ${out.mb} MB in ${out.path}. Jetzt committen, dann ist es auf Vercel.`);
        } catch (err) {
            hint(`Fehler: ${(err as Error).message}`);
        } finally {
            btnFinal.disabled = false;
            render();
        }
    };

    render();
};

export { initAuthor };
