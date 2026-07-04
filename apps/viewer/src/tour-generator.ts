import { Vec3 } from 'playcanvas';

import type { Collision } from './collision';
import type { Global } from './types';

// Automatic guided-tour ("Rundgang") generation: the annotations are the
// waypoints, the flight path is derived from the scan — instead of hand-
// authoring a track per property.
//
// Grammar borrowed from professional real-estate drone videos:
//   - smooth constant-speed travel with eased start/stop,
//   - a framing viewpoint per annotation (comfortable distance, clear line
//     of sight) approached in order,
//   - the gaze leads along the path and pans onto each highlight during the
//     approach, then releases forward again (the in-viewer fly-by reveal +
//     slow-motion pick the moment up from there).
//
// The generator runs INSIDE the viewer (debug entry points only): collision,
// annotations and the start camera are already loaded here, so walkability
// and sight lines come from the same collision raycasts the walk mode uses.
// Output is a ready settings.animTracks[0] object — bake it into the
// property's settings.json at prep time:
//
//     viewer.generateTour()          // returns the track object
//
// v1 scope: single floor level (the BFS refuses big floor steps).

const CELL = 0.3;               // occupancy grid resolution (m)
const EYE = 1.45;               // camera height above the floor (m)
const CLEARANCE = 1.85;         // required headroom above the floor (m)
const FLOOR_TOL = 0.4;          // max floor-height step between neighbors (m)
const LATERAL_TOL = 0.28;       // corner-sample floor deviation (furniture edge guard)
const SPEED = 0.5;              // cruise speed in authored track seconds (m/s)
const EASE_S = 1.8;             // ease-in/out duration at the ends (s)
const KEY_DT = 0.35;            // seconds between emitted keyframes
const VIEW_MIN = 1.5;           // POI viewpoint distance window (m)
const VIEW_MAX = 3.6;
const VIEW_IDEAL = 2.3;
const LOOKAHEAD_M = 1.8;        // forward gaze distance along the path (m)
const GAZE_DROP = 0.12;         // default gaze rests slightly below eye level (m)
const POI_BLEND_M = 3.2;        // arc-length window around a POI where the gaze pans onto it (m)
const MAX_CELLS = 60000;        // BFS safety bound

type Cell = { ix: number; iz: number; x: number; z: number; floor: number };

const key = (ix: number, iz: number) => `${ix},${iz}`;

const initTourGenerator = (global: Global, collision: Collision | null) => {
    if (!global.config.devtools) return;

    const generate = (): object | null => {
        if (!collision) {
            console.warn('tour-generator: no collision data.');
            return null;
        }
        const annotations = global.settings.annotations ?? [];
        if (annotations.length === 0) {
            console.warn('tour-generator: no annotations to route through.');
            return null;
        }

        // ---- occupancy grid via collision raycasts -----------------------
        const floorAt = (x: number, z: number, refY: number): number | null => {
            // cast from just above the reference eye height — starting any
            // higher would begin ABOVE typical ceilings and hit those instead
            const down = collision.queryRay(x, refY + 0.35, z, 0, -1, 0, 3);
            if (!down) return null;
            const floor = down.y;
            if (Math.abs((floor + EYE) - refY) > 1.0) return null;
            const up = collision.queryRay(x, floor + 0.25, z, 0, 1, 0, CLEARANCE + 0.25);
            if (up && (up.y - floor) < CLEARANCE) return null;
            return floor;
        };

        const walkableCell = (x: number, z: number, refFloor: number): number | null => {
            const c = floorAt(x, z, refFloor + EYE);
            if (c === null || Math.abs(c - refFloor) > FLOOR_TOL) return null;
            // corner samples keep the path off furniture edges and walls
            for (const [ox, oz] of [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]]) {
                const f = floorAt(x + ox, z + oz, c + EYE);
                if (f === null || Math.abs(f - c) > LATERAL_TOL) return null;
            }
            return c;
        };

        // seed: the property's start camera, else an annotation's floor spot
        const cam0 = (global.settings.cameras?.[0] as any);
        const seedCandidates: [number, number, number][] = [];
        const camPos = cam0?.initial?.position ?? cam0?.position;
        if (Array.isArray(camPos)) seedCandidates.push([camPos[0], camPos[1], camPos[2]]);
        for (const a of annotations) seedCandidates.push([a.position[0], a.position[1] + 1.2, a.position[2]]);

        const cells = new Map<string, Cell>();
        let seeded = false;
        for (const [sx, sy, sz] of seedCandidates) {
            const down = collision.queryRay(sx, sy + 0.5, sz, 0, -1, 0, 5);
            if (!down) continue;
            const ix = Math.round(sx / CELL);
            const iz = Math.round(sz / CELL);
            const floor = walkableCell(ix * CELL, iz * CELL, down.y);
            if (floor === null) continue;
            // BFS flood fill over walkable space
            const queue: Cell[] = [{ ix, iz, x: ix * CELL, z: iz * CELL, floor }];
            cells.set(key(ix, iz), queue[0]);
            while (queue.length > 0 && cells.size < MAX_CELLS) {
                const c = queue.shift()!;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nix = c.ix + dx;
                    const niz = c.iz + dz;
                    if (cells.has(key(nix, niz))) continue;
                    const f = walkableCell(nix * CELL, niz * CELL, c.floor);
                    if (f === null) continue;
                    const n = { ix: nix, iz: niz, x: nix * CELL, z: niz * CELL, floor: f };
                    cells.set(key(nix, niz), n);
                    queue.push(n);
                }
            }
            seeded = cells.size > 30;
            if (seeded) break;
            cells.clear();
        }
        if (!seeded) {
            console.warn('tour-generator: could not map a walkable area.');
            return null;
        }

        // ---- one framing viewpoint per annotation ------------------------
        const los = (from: Vec3, to: number[]): boolean => {
            const dx = to[0] - from.x;
            const dy = to[1] - from.y;
            const dz = to[2] - from.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < 0.01) return true;
            const hit = collision.queryRay(from.x, from.y, from.z, dx / dist, dy / dist, dz / dist, dist);
            if (!hit) return true;
            // hits at/behind the annotation surface itself count as visible
            const hd = Math.sqrt((hit.x - to[0]) ** 2 + (hit.y - to[1]) ** 2 + (hit.z - to[2]) ** 2);
            return hd < 0.45;
        };

        const eyeOf = (c: Cell) => new Vec3(c.x, c.floor + EYE, c.z);

        const viewpointFor = (ann: { position: number[] }): Cell | null => {
            let best: Cell | null = null;
            let bestScore = Infinity;
            for (const c of cells.values()) {
                const dx = c.x - ann.position[0];
                const dz = c.z - ann.position[2];
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d < VIEW_MIN || d > VIEW_MAX) continue;
                if (Math.abs((c.floor + EYE) - ann.position[1]) > 2.4) continue;
                const score = Math.abs(d - VIEW_IDEAL);
                if (score >= bestScore) continue;
                if (!los(eyeOf(c), ann.position)) continue;
                best = c;
                bestScore = score;
            }
            if (!best) console.warn('tour-generator: no viewpoint with sight line for', (ann as any).title);
            return best;
        };

        const pois: { cell: Cell; ann: { position: number[] } }[] = [];
        for (const ann of annotations) {
            const cell = viewpointFor(ann);
            if (cell) pois.push({ cell, ann });
        }
        if (pois.length === 0) return null;

        // ---- order the POIs (shortest chain from the start) ---------------
        const startCell = (() => {
            let best: Cell | null = null;
            let bd = Infinity;
            const sx = Array.isArray(camPos) ? camPos[0] : pois[0].cell.x;
            const sz = Array.isArray(camPos) ? camPos[2] : pois[0].cell.z;
            for (const c of cells.values()) {
                const d = (c.x - sx) ** 2 + (c.z - sz) ** 2;
                if (d < bd) {
                    bd = d; best = c;
                }
            }
            return best!;
        })();

        const d2 = (a: Cell, b: Cell) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
        const order: typeof pois = [];
        const remaining = [...pois];
        let cursor = startCell;
        while (remaining.length > 0) {
            remaining.sort((a, b) => d2(a.cell, cursor) - d2(b.cell, cursor));
            const next = remaining.shift()!;
            order.push(next);
            cursor = next.cell;
        }

        // ---- A* between consecutive waypoints ------------------------------
        const astar = (from: Cell, to: Cell): Cell[] | null => {
            const open = new Map<string, { c: Cell; g: number; f: number; prev: string | null }>();
            const closed = new Map<string, { c: Cell; g: number; prev: string | null }>();
            const h = (c: Cell) => Math.sqrt(d2(c, to));
            const kf = (c: Cell) => key(c.ix, c.iz);
            open.set(kf(from), { c: from, g: 0, f: h(from), prev: null });
            while (open.size > 0) {
                let bestK = '';
                let bestF = Infinity;
                for (const [k, n] of open) {
                    if (n.f < bestF) {
                        bestF = n.f; bestK = k;
                    }
                }
                const cur = open.get(bestK)!;
                open.delete(bestK);
                closed.set(bestK, { c: cur.c, g: cur.g, prev: cur.prev });
                if (bestK === kf(to)) break;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                    const nk = key(cur.c.ix + dx, cur.c.iz + dz);
                    if (closed.has(nk)) continue;
                    const n = cells.get(nk);
                    if (!n || Math.abs(n.floor - cur.c.floor) > FLOOR_TOL) continue;
                    // keep some distance from walls: cells with missing
                    // neighbors cost extra
                    let openness = 0;
                    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        if (cells.has(key(n.ix + ox, n.iz + oz))) openness++;
                    }
                    const step = (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * CELL + (4 - openness) * 0.12;
                    const g = cur.g + step;
                    const existing = open.get(nk);
                    if (!existing || g < existing.g) {
                        open.set(nk, { c: n, g, f: g + h(n), prev: bestK });
                    }
                }
            }
            const endK = kf(to);
            if (!closed.has(endK)) return null;
            const path: Cell[] = [];
            let k: string | null = endK;
            while (k) {
                const n = closed.get(k)!;
                path.unshift(n.c);
                k = n.prev;
            }
            return path;
        };

        let route: Cell[] = [startCell];
        cursor = startCell;
        for (const poi of order) {
            const seg = astar(cursor, poi.cell);
            if (!seg) {
                console.warn('tour-generator: no route to a viewpoint, skipping one POI.');
                continue;
            }
            route = route.concat(seg.slice(1));
            cursor = poi.cell;
        }
        if (route.length < 4) {
            console.warn('tour-generator: route too short.');
            return null;
        }

        // ---- smooth (Chaikin) + constant-speed resample with eased ends ----
        let pts = route.map(c => new Vec3(c.x, c.floor + EYE, c.z));
        for (let it = 0; it < 3; it++) {
            const out: Vec3[] = [pts[0]];
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i];
                const b = pts[i + 1];
                out.push(new Vec3().lerp(a, b, 0.25), new Vec3().lerp(a, b, 0.75));
            }
            out.push(pts[pts.length - 1]);
            pts = out;
        }

        // cumulative arc length
        const arc = [0];
        for (let i = 1; i < pts.length; i++) {
            arc.push(arc[i - 1] + pts[i].distance(pts[i - 1]));
        }
        const total = arc[arc.length - 1];
        const at = (s: number): Vec3 => {
            const ss = Math.max(0, Math.min(total, s));
            let i = 1;
            while (i < arc.length - 1 && arc[i] < ss) i++;
            const t = (ss - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1]);
            return new Vec3().lerp(pts[i - 1], pts[i], t);
        };

        // eased speed profile: distance covered as a function of time
        const easeDist = total - SPEED * EASE_S;   // distance outside the two easing ramps (each ramp covers SPEED*EASE_S/2)
        const cruiseT = Math.max(0, easeDist / SPEED);
        const duration = cruiseT + 2 * EASE_S;
        const distAtTime = (t: number): number => {
            let d = 0;
            const tt = Math.max(0, Math.min(duration, t));
            // ramp up
            const up = Math.min(tt, EASE_S);
            d += SPEED * (up * up) / (2 * EASE_S);
            // cruise
            if (tt > EASE_S) d += SPEED * (Math.min(tt, duration - EASE_S) - EASE_S);
            // ramp down
            if (tt > duration - EASE_S) {
                const r = tt - (duration - EASE_S);
                d += SPEED * (r - (r * r) / (2 * EASE_S));
            }
            return d;
        };

        // arc positions of the POI viewpoints (for gaze scheduling)
        const poiArcs = order.map((poi) => {
            let bd = Infinity;
            let bs = 0;
            for (let i = 0; i < pts.length; i++) {
                const dd = (pts[i].x - poi.cell.x) ** 2 + (pts[i].z - (poi.cell.z)) ** 2;
                if (dd < bd) {
                    bd = dd; bs = arc[i];
                }
            }
            return { s: bs, ann: poi.ann };
        });

        const smoothstep = (x: number) => {
            const c = Math.max(0, Math.min(1, x));
            return c * c * (3 - 2 * c);
        };

        // ---- emit keyframes -------------------------------------------------
        const times: number[] = [];
        const position: number[] = [];
        const target: number[] = [];
        const fov: number[] = [];   // schema requires per-key fov; constant walk FOV
        for (let t = 0; t <= duration + 1e-6; t += KEY_DT) {
            const s = distAtTime(t);
            const p = at(s);
            // default gaze: lead along the path, resting slightly low
            const ahead = at(s + LOOKAHEAD_M);
            const def = new Vec3(ahead.x, ahead.y - GAZE_DROP, ahead.z);
            // pan onto the nearest POI inside its blend window
            let tgt = def;
            let bestW = 0;
            for (const poi of poiArcs) {
                const w = smoothstep(1 - Math.abs(s - poi.s) / POI_BLEND_M);
                if (w > bestW) {
                    bestW = w;
                    tgt = new Vec3().lerp(def, new Vec3(poi.ann.position[0], poi.ann.position[1], poi.ann.position[2]), w);
                }
            }
            times.push(Number(t.toFixed(3)));
            position.push(Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3)));
            target.push(Number(tgt.x.toFixed(3)), Number(tgt.y.toFixed(3)), Number(tgt.z.toFixed(3)));
            fov.push(96);
        }

        const track = {
            name: 'Rundgang',
            duration: Number(times[times.length - 1].toFixed(3)),
            frameRate: 1,
            loopMode: 'none',
            interpolation: 'spline',
            smoothness: 0.5,
            keyframes: { times, values: { position, target, fov } }
        };
        console.log(`tour-generator: ${order.length} POIs, ${cells.size} cells, ${total.toFixed(1)} m, ${track.duration}s, ${times.length} keys`);
        return track;
    };

    // debug-only API (window.viewer is exposed on the same entry points)
    (window as any).generateTour = generate;
};

export { initTourGenerator };
