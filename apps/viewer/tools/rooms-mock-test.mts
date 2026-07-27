// Validate per-room segmentation + aerial pose gen WITHOUT a slow carve, using a
// procedural 3-room apartment as a mock collision (only isFreeAt is needed).
//   npx tsx apps/viewer/tools/rooms-mock-test.mts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { segmentRooms, RoomSegment } from './voxel-rooms.mts';
import { validateV2 } from '../src/schemas/v2.ts';

// --- procedural 3-room flat, Y-up, floor 0, ceiling 2.7 ---------------------
// A: left big room. B: bottom-right. C: top-right. 0.9 m doorways in the two
// interior walls (wall1 at x≈4, wall2 at z≈3.5 on the right half).
const freeXZ = (x: number, z: number): boolean => {
    if (x <= 0.15 || x >= 9.85 || z <= 0.15 || z >= 6.85) return false;   // outer walls
    if (x > 3.9 && x < 4.1 && !(z > 3.0 && z < 3.9)) return false;         // wall1 + doorway
    if (z > 3.4 && z < 3.6 && x > 4.1 && !(x > 6.0 && x < 6.9)) return false; // wall2 + doorway
    return true;
};
const mock = {
    voxelResolution: 0.05,
    isFreeAt: (x: number, y: number, z: number) => y > 0.05 && y < 2.65 && freeXZ(x, z)
} as any;
const gb = { min: [0, 0, 0], max: [10, 2.7, 7] };
const floorY = 0, droneY = 2.4;
const END = 0.42, CROSS = 0.18;
const round = (n: number) => Math.round(n * 1000) / 1000;

// --- segment + leak filter (mirror derive-settings) -------------------------
const segmented = segmentRooms(mock, gb, floorY + 0.6, floorY);
const rooms = segmented.filter(r => r.area >= 4 && r.area <= 250 && Math.max(r.extentX, r.extentZ) <= 25);
console.log(`segmented ${segmented.length} → after leak filter ${rooms.length} room(s):`);
rooms.forEach((r, i) => console.log(`  Raum ${i + 1}: area=${r.area}m² center=[${r.center}] extent=${r.extentX}×${r.extentZ}m bbox x[${r.bbox.minX},${r.bbox.maxX}] z[${r.bbox.minZ},${r.bbox.maxZ}]`));

// --- per-room aerial (copy of derive-settings roomAerial) -------------------
const roomAerial = (r: RoomSegment) => {
    const rcx = r.center[0], rcz = r.center[2];
    const rLongX = r.extentX >= r.extentZ;
    const rL = Math.max(r.extentX, r.extentZ);
    const ux = rLongX ? 1 : 0, uz = rLongX ? 0 : 1;
    let camX = rcx, camZ = rcz;
    for (const off of [END, -END, 0.3, -0.3, 0.18, -0.18, 0]) {
        const x = rcx + ux * rL * off, z = rcz + uz * rL * off;
        if (mock.isFreeAt(x, floorY + 1.0, z)) { camX = x; camZ = z; break; }
    }
    const dx = rcx - camX, dz = rcz - camZ; const dl = Math.hypot(dx, dz) || 1;
    const tx = rcx + (dx / dl) * rL * CROSS, tz = rcz + (dz / dl) * rL * CROSS;
    const fov = Math.round(Math.min(92, Math.max(60, 55 + rL * 4)));
    return { position: [round(camX), round(droneY), round(camZ)], target: [round(tx), round(floorY + 0.2), round(tz)], fov };
};
const aerials = rooms.map(roomAerial);
console.log('\nper-room aerials (camera must be free/inside its room):');
aerials.forEach((a, i) => {
    const inside = mock.isFreeAt(a.position[0], floorY + 1.0, a.position[2]);
    console.log(`  Raum ${i + 1}: pos=[${a.position}] target=[${a.target}] fov=${a.fov}  cameraInsideRoom=${inside}`);
});

// --- settings.rooms + validateV2 --------------------------------------------
const settingsRooms = rooms.map((r, i) => {
    const { minX, maxX, minZ, maxZ } = r.bbox; const y = round(floorY);
    const c = (x: number, z: number) => [round(x), y, round(z)];
    return { name: `Raum ${i + 1}`, center: [round(r.center[0]), y, round(r.center[2])],
        lines: [{ a: c(minX, minZ), b: c(maxX, minZ) }, { a: c(maxX, minZ), b: c(maxX, maxZ) },
                { a: c(maxX, maxZ), b: c(minX, maxZ) }, { a: c(minX, maxZ), b: c(minX, minZ) }], area: r.area };
});
const base = JSON.parse(readFileSync(resolve('../website/public/viewer/settings.json'), 'utf8'));
const settings: any = { ...base,
    cameras: [{ initial: { position: [5, 1.6, 3.5], target: [6, 1.6, 3.5], fov: 80 } }],
    aerialViews: aerials, rooms: settingsRooms, annotations: [], animTracks: [], pois: [],
    annotationMarkers: 'hidden', startMode: 'default' };
if (settings.staging) settings.staging = { ...settings.staging, enabled: false, styles: [] };
try {
    validateV2(settings);
    console.log('\n✓ validateV2 PASSED (rooms + aerialViews accepted)');
    const out = validateV2(settings) as any;
    console.log(`  validated rooms kept: ${out.rooms ? out.rooms.length : 'STRIPPED/undefined'}, aerialViews: ${out.aerialViews?.length}`);
} catch (e) {
    console.log('\n✗ validateV2 FAILED:', String(e));
}
