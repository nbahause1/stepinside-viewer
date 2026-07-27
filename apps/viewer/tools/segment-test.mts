// Standalone test: segment the carved navigable voxel into rooms.
//   npx tsx apps/viewer/tools/segment-test.mts <scene.voxel.json>
// Prints detected rooms (center, XZ bbox, area) so we can validate the
// segmentation before wiring it into derive-settings.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { VoxelCollision, loadVoxelCollision } from '../src/collision/voxel-collision.ts';
import { findCylinderSpawn } from '../src/collision/find-spawn.ts';
import { segmentRooms } from './voxel-rooms.mts';

// fetch polyfill for file:// (same as derive-settings)
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('file:')) {
        const p = fileURLToPath(url);
        return { ok: true, statusText: 'OK',
            json: async () => JSON.parse(readFileSync(p, 'utf8')),
            arrayBuffer: async () => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } } as any;
    }
    return realFetch(input);
}) as typeof fetch;

const voxelJsonPath = resolve(process.argv[2]);
const meta = JSON.parse(readFileSync(voxelJsonPath, 'utf8'));
const collision: VoxelCollision = await loadVoxelCollision(pathToFileURL(voxelJsonPath).href);

const g = meta.gridBounds;
const cx0 = (g.min[0] + g.max[0]) / 2, cz0 = (g.min[2] + g.max[2]) / 2, cy0 = (g.min[1] + g.max[1]) / 2;
const spawn = { x: 0, y: 0, z: 0 };
findCylinderSpawn(collision, cx0, cy0, cz0, 0.9, 0.3, spawn);
const floorY = spawn.y;
const sampleY = floorY + 0.6;

const rooms = segmentRooms(collision, g, sampleY, floorY);
console.log(`floorY=${floorY.toFixed(2)} sampleY=${sampleY.toFixed(2)} gridExtent=${(g.max[0]-g.min[0]).toFixed(1)}×${(g.max[2]-g.min[2]).toFixed(1)} m`);
console.log(`detected ${rooms.length} room(s):`);
rooms.forEach((r, i) => console.log(`  #${i} area=${r.area}m²  center=[${r.center}]  extent=${r.extentX}×${r.extentZ}m  bbox x[${r.bbox.minX},${r.bbox.maxX}] z[${r.bbox.minZ},${r.bbox.maxZ}]`));
