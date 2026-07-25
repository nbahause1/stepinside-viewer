// Pure room segmentation over a carved navigable voxel (no side effects).
//
// Slices the collision grid's free space at sampleY into a 2D occupancy map,
// erodes ~0.5 m so doorways (~0.9 m) sever, labels connected cores (>=1.5 m²),
// then assigns every free cell back to its nearest core (multi-source BFS).
// Result: one entry per room, sorted by area desc. Used by segment-test.mts
// (standalone validation) and derive-settings.mts (per-room aerials + rooms[]).
import { VoxelCollision } from '../src/collision/voxel-collision.ts';

export interface RoomSegment {
    area: number;
    center: [number, number, number];
    bbox: { minX: number, maxX: number, minZ: number, maxZ: number };
    extentX: number;
    extentZ: number;
}

export function segmentRooms(collision: VoxelCollision, gb: any, sampleY: number, floorY: number): RoomSegment[] {
    const SEG = 0.1;                                   // segmentation cell size (m)
    const minX = gb.min[0], minZ = gb.min[2];
    const nx = Math.ceil((gb.max[0] - gb.min[0]) / SEG);
    const nz = Math.ceil((gb.max[2] - gb.min[2]) / SEG);
    const idx = (ix: number, iz: number) => ix * nz + iz;
    const free = new Uint8Array(nx * nz);
    for (let ix = 0; ix < nx; ix++) {
        const x = minX + (ix + 0.5) * SEG;
        for (let iz = 0; iz < nz; iz++) {
            const z = minZ + (iz + 0.5) * SEG;
            free[idx(ix, iz)] = collision.isFreeAt(x, sampleY, z) ? 1 : 0;
        }
    }

    // ---- erode by doorHalf to sever doorway connections --------------------
    const R = 5;                                        // 0.5 m erosion (door ~0.9 m closes)
    const minF = (src: Uint8Array) => {                 // square-kernel erosion, separable
        const tmp = new Uint8Array(nx * nz), out = new Uint8Array(nx * nz);
        for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
            let m = 1; for (let d = -R; d <= R; d++) { const j = iz + d; if (j < 0 || j >= nz || !src[idx(ix, j)]) { m = 0; break; } } tmp[idx(ix, iz)] = m;
        }
        for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
            let m = 1; for (let d = -R; d <= R; d++) { const j = ix + d; if (j < 0 || j >= nx || !tmp[idx(j, iz)]) { m = 0; break; } } out[idx(ix, iz)] = m;
        }
        return out;
    };
    const eroded = minF(free);

    // ---- connected components on eroded cores (4-conn) --------------------
    const label = new Int32Array(nx * nz).fill(0);
    let next = 0; const coreArea: number[] = [0];
    const stack: number[] = [];
    for (let s = 0; s < nx * nz; s++) {
        if (!eroded[s] || label[s]) continue;
        next++; coreArea[next] = 0; label[s] = next; stack.push(s);
        while (stack.length) {
            const c = stack.pop()!; coreArea[next]++;
            const ix = (c / nz) | 0, iz = c % nz;
            const nb = [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]];
            for (const [jx, jz] of nb) { if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue; const j = idx(jx, jz); if (eroded[j] && !label[j]) { label[j] = next; stack.push(j); } }
        }
    }
    const CELL = SEG * SEG;
    const keep = new Set<number>();
    for (let l = 1; l <= next; l++) if (coreArea[l] * CELL >= 1.5) keep.add(l);   // >=1.5 m² core = a room

    // ---- assign ALL free cells to nearest kept core (multi-source BFS) -----
    const roomOf = new Int32Array(nx * nz).fill(0);
    const q: number[] = [];
    for (let s = 0; s < nx * nz; s++) { if (label[s] && keep.has(label[s])) { roomOf[s] = label[s]; q.push(s); } }
    let head = 0;
    while (head < q.length) {
        const c = q[head++]; const ix = (c / nz) | 0, iz = c % nz; const r = roomOf[c];
        const nb = [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]];
        for (const [jx, jz] of nb) { if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue; const j = idx(jx, jz); if (free[j] && !roomOf[j]) { roomOf[j] = r; q.push(j); } }
    }

    // ---- per-room stats ----------------------------------------------------
    const rooms = new Map<number, { cells: number, sx: number, sz: number, minX: number, maxX: number, minZ: number, maxZ: number }>();
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const r = roomOf[idx(ix, iz)]; if (!r) continue;
        const wx = minX + (ix + 0.5) * SEG, wz = minZ + (iz + 0.5) * SEG;
        let e = rooms.get(r); if (!e) { e = { cells: 0, sx: 0, sz: 0, minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }; rooms.set(r, e); }
        e.cells++; e.sx += wx; e.sz += wz; e.minX = Math.min(e.minX, wx); e.maxX = Math.max(e.maxX, wx); e.minZ = Math.min(e.minZ, wz); e.maxZ = Math.max(e.maxZ, wz);
    }
    return [...rooms.values()].map(e => ({
        area: +(e.cells * CELL).toFixed(1),
        center: [+(e.sx / e.cells).toFixed(2), +floorY.toFixed(2), +(e.sz / e.cells).toFixed(2)] as [number, number, number],
        bbox: { minX: +e.minX.toFixed(2), maxX: +e.maxX.toFixed(2), minZ: +e.minZ.toFixed(2), maxZ: +e.maxZ.toFixed(2) },
        extentX: +(e.maxX - e.minX).toFixed(2), extentZ: +(e.maxZ - e.minZ).toFixed(2)
    })).sort((a, b) => b.area - a.area);
}
