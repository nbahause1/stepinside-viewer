// Room segmentation from a carved .voxel (Auto-Experience Pipeline).
//
// A scan of a whole flat is ONE connected navigable volume — the rooms are only
// separated by doorways. This splits that volume into individual rooms so the
// pipeline can emit per-room measurements (settings.rooms[]) and a dollhouse
// footprint that spans the WHOLE flat (not one room).
//
// Method (distance-transform seeded watershed on the standable floor mask —
// robust to room size and doorway width, no magic erosion radius):
//   1. floor mask — XZ cells where a person can stand (clear ankle→head column)
//   2. distance transform — each floor cell's distance to the nearest wall
//   3. seeds — the wall-farthest points (one per room core; a room's centre is
//      always far from walls, a doorway/corridor never is), merged within reach
//   4. watershed — flood outward from seeds down the distance gradient; floor
//      cells meet at the low-distance ridges that ARE the doorways → room labels
//   5. per room: world bbox, true floor area (cell count), ceiling by up-ray
//
// Pure geometry, no AI, deterministic. Runs against the viewer's OWN collision
// code (world-space queries — flip-safe on v1.0 FlippedVoxelCollision).
import type { VoxelCollision } from '../src/collision/voxel-collision.ts';

export type SegmentedRoom = {
    minX: number; maxX: number; minZ: number; maxZ: number;
    floorY: number; ceilingY: number; areaM2: number; cells: number;
};

export type SegmentOpts = {
    gridBounds: { min: number[]; max: number[] };
    floorY: number;                 // global floor Y from the spawn
    cell?: number;                  // segmentation grid pitch (m), default 0.10
    standHeight?: number;           // clear column a person needs (m), default 1.7
    seedMinDist?: number;           // a room seed must be >= this far from any wall (m), default 0.75
    mergeDist?: number;             // seeds closer than this collapse to one room (m), default 1.4
    minRoomM2?: number;             // discard rooms smaller than this, default 2.5
    // Two basins stay separate only if the WIDEST point of their connection (the
    // "pass") is a real constriction — narrower than this fraction of the smaller
    // basin's deepest point. A doorway is narrow (low pass); an open-plan plateau
    // is not (high pass → merge). Lower = splits more eagerly. Default 0.66.
    passFraction?: number;
};

export function segmentRooms(col: VoxelCollision, opts: SegmentOpts): { rooms: SegmentedRoom[]; clipY: number } | null {
    const g = opts.gridBounds;
    const CELL = opts.cell ?? 0.10;
    const STAND = opts.standHeight ?? 1.7;
    const SEED_MIN = opts.seedMinDist ?? 0.75;
    const MERGE = opts.mergeDist ?? 1.4;
    const MIN_M2 = opts.minRoomM2 ?? 2.5;
    const PASS_FRAC = opts.passFraction ?? 0.66;
    const cellArea = CELL * CELL;

    const nx = Math.floor((g.max[0] - g.min[0]) / CELL);
    const nz = Math.floor((g.max[2] - g.min[2]) / CELL);
    if (nx < 2 || nz < 2) return null;
    const at = (i: number, j: number) => i * nz + j;
    const wx = (i: number) => g.min[0] + (i + 0.5) * CELL;
    const wz = (j: number) => g.min[2] + (j + 0.5) * CELL;

    // -- 1. standable floor mask ------------------------------------------------
    // A cell is standable if the column from just above the floor to head height
    // is clear. Probe a few heights anchored to the global floor (robust to
    // furniture: a blocked waist/head correctly excludes wardrobe/counter cells).
    const floor = new Uint8Array(nx * nz);
    const probes = [0.1, 0.9, STAND - 0.1];             // ankle, waist, head
    let floorCount = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = wx(i), z = wz(j);
        let ok = true;
        for (const dy of probes) if (!col.isFreeAt(x, opts.floorY + dy, z)) { ok = false; break; }
        if (ok) { floor[at(i, j)] = 1; floorCount++; }
    }
    if (floorCount * cellArea < MIN_M2) return null;    // nothing standable → caller emits []

    // -- 2. distance transform: cells → nearest wall (BFS from non-floor) -------
    // dist in CELL units; non-floor = 0. Two-pass chamfer would give Euclidean;
    // a 4-conn BFS layer is enough to seed + drive the watershed.
    const dist = new Float32Array(nx * nz).fill(-1);
    let front: number[] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        // a floor cell touching a non-floor cell (or the grid edge) is distance ~1
        if (!floor[at(i, j)]) continue;
        let edge = false;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz || !floor[at(ni, nj)]) { edge = true; break; }
        }
        if (edge) { dist[at(i, j)] = 1; front.push(at(i, j)); }
    }
    let d = 1;
    while (front.length) {
        const next: number[] = [];
        for (const idx of front) {
            const i = (idx / nz) | 0, j = idx % nz;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const ni = i + di, nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
                const nidx = at(ni, nj);
                if (floor[nidx] && dist[nidx] < 0) { dist[nidx] = d + 1; next.push(nidx); }
            }
        }
        front = next; d++;
    }

    // -- 3. seeds: wall-farthest points, one per room, merged within reach ------
    // Walk floor cells from farthest-from-wall inward; a cell opens a NEW room
    // only if it is deep enough (SEED_MIN) and no existing seed is within MERGE.
    const seedMinCells = SEED_MIN / CELL, mergeCells = MERGE / CELL;
    const order: number[] = [];
    for (let idx = 0; idx < dist.length; idx++) if (dist[idx] > 0) order.push(idx);
    order.sort((a, b) => dist[b] - dist[a]);
    const seeds: { i: number; j: number; label: number }[] = [];
    const owner = new Int32Array(nx * nz);              // 0 = unassigned
    let labels = 0;
    for (const idx of order) {
        if (dist[idx] < seedMinCells) break;             // rest are too shallow to be room centres
        const i = (idx / nz) | 0, j = idx % nz;
        let near = false;
        for (const s of seeds) if (Math.hypot(i - s.i, j - s.j) < mergeCells) { near = true; break; }
        if (near) continue;
        seeds.push({ i, j, label: ++labels });
        owner[idx] = labels;
    }
    if (labels === 0) {                                  // one shallow blob → single room seed at the deepest cell
        const idx = order[0];
        owner[idx] = ++labels;
        seeds.push({ i: (idx / nz) | 0, j: idx % nz, label: labels });
    }

    // -- 4. watershed: assign every floor cell by descending distance -----------
    // Processing high→low distance means a cell inherits the label of an already-
    // assigned deeper neighbour; the last cells to fill are the doorway ridges,
    // where the two rooms' floods meet — the natural room boundary.
    for (const idx of order) {
        if (owner[idx]) continue;
        const i = (idx / nz) | 0, j = idx % nz;
        let best = 0, bestD = -1;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            const nidx = at(ni, nj);
            if (owner[nidx] && dist[nidx] > bestD) { bestD = dist[nidx]; best = owner[nidx]; }
        }
        if (best) owner[idx] = best;
    }
    // second pass for any cell whose neighbours were all unassigned on first look
    for (let pass = 0; pass < 3; pass++) for (const idx of order) {
        if (owner[idx]) continue;
        const i = (idx / nz) | 0, j = idx % nz;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            if (owner[at(ni, nj)]) { owner[idx] = owner[at(ni, nj)]; break; }
        }
    }

    // -- 4b. merge basins with no real doorway between them ---------------------
    // Watershed over-splits large open rooms (a broad distance plateau spawns
    // several seeds). Merge two basins unless the WIDEST point of their shared
    // border (the "pass") is a genuine constriction — a doorway. peak = deepest
    // point of a basin; pass = highest distance on the border between two basins.
    const peak = new Float32Array(labels + 1);
    for (let idx = 0; idx < owner.length; idx++) if (owner[idx]) peak[owner[idx]] = Math.max(peak[owner[idx]], dist[idx]);
    const passH = new Map<string, number>();             // "a,b" (a<b) → widest bottleneck distance
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const laA = owner[at(i, j)]; if (!laA) continue;
        for (const [di, dj] of [[1, 0], [0, 1]] as const) {
            const ni = i + di, nj = j + dj;
            if (ni >= nx || nj >= nz) continue;
            const laB = owner[at(ni, nj)];
            if (!laB || laB === laA) continue;
            const a = Math.min(laA, laB), b = Math.max(laA, laB), key = `${a},${b}`;
            const gap = Math.min(dist[at(i, j)], dist[at(ni, nj)]);
            if (gap > (passH.get(key) ?? 0)) passH.set(key, gap);
        }
    }
    // union-find over labels
    const parent = Array.from({ length: labels + 1 }, (_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    let merged = true;
    while (merged) {
        merged = false;
        for (const [key, pass] of passH) {
            const [a, b] = key.split(',').map(Number);
            const ra = find(a), rb = find(b);
            if (ra === rb) continue;
            if (pass >= PASS_FRAC * Math.min(peak[a], peak[b])) { parent[ra] = rb; merged = true; }
        }
    }
    for (let idx = 0; idx < owner.length; idx++) if (owner[idx]) owner[idx] = find(owner[idx]);

    // -- 5. per-room bbox / area / ceiling -------------------------------------
    const acc = new Map<number, { minI: number; maxI: number; minJ: number; maxJ: number; cells: number }>();
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const lab = owner[at(i, j)];
        if (!lab) continue;
        const a = acc.get(lab) ?? { minI: i, maxI: i, minJ: j, maxJ: j, cells: 0 };
        if (i < a.minI) a.minI = i; if (i > a.maxI) a.maxI = i;
        if (j < a.minJ) a.minJ = j; if (j > a.maxJ) a.maxJ = j;
        a.cells++;
        acc.set(lab, a);
    }

    const rooms: SegmentedRoom[] = [];
    const ceilings: number[] = [];
    for (const [, a] of acc) {
        if (a.cells * cellArea < MIN_M2) continue;
        const minX = g.min[0] + a.minI * CELL, maxX = g.min[0] + (a.maxI + 1) * CELL;
        const minZ = g.min[2] + a.minJ * CELL, maxZ = g.min[2] + (a.maxJ + 1) * CELL;
        const cxr = (minX + maxX) / 2, czr = (minZ + maxZ) / 2;
        const up = col.queryRay(cxr, opts.floorY + 0.2, czr, 0, 1, 0, 1000);
        const ceilingY = up ? up.y : g.max[1];
        ceilings.push(ceilingY);
        rooms.push({ minX, maxX, minZ, maxZ, floorY: opts.floorY, ceilingY, areaM2: a.cells * cellArea, cells: a.cells });
    }
    if (!rooms.length) return null;
    rooms.sort((r1, r2) => r2.areaM2 - r1.areaM2);

    // dollhouse cut: below the LOWEST room ceiling (so every ceiling is removed)
    // but above ~2 m door frames; clamped so a freak low ceiling can't over-cut.
    const minCeil = Math.min(...ceilings);
    const clipY = Math.max(opts.floorY + 2.0, Math.min(minCeil - 0.15, opts.floorY + 2.6));

    return { rooms, clipY };
}
