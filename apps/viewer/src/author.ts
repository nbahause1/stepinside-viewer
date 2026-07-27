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
    const { config, state, camera } = global;

    // The save target is derivable only from a Studio asset URL (?assets=/out/<pid>/<version>)
    const m = (config.assets ?? '').match(/^\/out\/([a-z0-9-]{1,64})\/(v\d+)$/);
    const target = m ? { pid: m[1], version: m[2] } : null;

    // Working copies — replace-array semantics on save.
    const rooms: any[] = Array.isArray(global.settings.rooms) ? [...(global.settings.rooms as any[])] : [];
    const annotations: any[] = Array.isArray(global.settings.annotations) ? [...(global.settings.annotations as any[])] : [];
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
        <button data-id="save" class="save">Speichern</button>
        <div class="entries" data-id="entries"></div>
        <div class="hintline" data-id="hint"></div>`;
    document.body.appendChild(bar);

    const btnHighlight = bar.querySelector('[data-id="highlight"]') as HTMLButtonElement;
    const btnSave = bar.querySelector('[data-id="save"]') as HTMLButtonElement;
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
        btnSave.textContent = dirty ? 'Speichern ✓' : 'Speichern';
        btnSave.disabled = !target || !dirty;
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

    // --- Speichern: replace-array POST to the Studio, then reload for review -
    btnSave.onclick = async () => {
        if (!target) return;
        btnSave.disabled = true;
        hint('Speichere …');
        try {
            const res = await fetch('/save-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pid: target.pid, version: target.version, rooms, annotations })
            });
            if (!res.ok) throw new Error(await res.text());
            hint('Gespeichert — lade neu zur Kontrolle …');
            window.location.reload();
        } catch (err) {
            hint(`Fehler: ${(err as Error).message}`);
            btnSave.disabled = false;
        }
    };

    render();
};

export { initAuthor };
