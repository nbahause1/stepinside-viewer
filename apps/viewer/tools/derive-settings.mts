// Headless geometry extraction (Auto-Experience Pipeline, Stage 2).
//
//   npx tsx apps/viewer/tools/derive-settings.mts <scene.voxel.json> <out/settings.json> <propertyId> [baseSettings.json]
//
// Runs the VIEWER'S OWN collision code (voxel-collision.ts + find-spawn.ts,
// both PlayCanvas-free) headless against the .voxel the scan pipeline already
// produces, and derives — from geometry alone, no AI — the per-scan settings
// fields that would otherwise be hand-authored:
//
//   • cameras[0].initial   — walkable spawn + eye height + longest-sightline hero target
//   • aerialViews[0]        — top-down "Drohnen" overview framed to the carved room
//   • startMode             — 'default'
//   • room-facts            — floor/ceiling Y, metric L×W×H (printed + written)
//
// Semantic fields (annotations, pois, animTracks, staging images) stay EMPTY —
// honestly-empty beats plausibly-wrong. The output is validated with the
// viewer's own validateV2 before it is written, so a bad carve fails loudly
// here instead of in the browser.
//
// The spawn/ray math is bit-identical to what the live viewer runs, because it
// IS the same code — no re-implementation drift.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VoxelCollision, loadVoxelCollision } from '../src/collision/voxel-collision.ts';
import { findCylinderSpawn, findSphereSpawn } from '../src/collision/find-spawn.ts';
import { validateV2 } from '../src/schemas/v2.ts';
import { segmentRooms, RoomSegment } from './voxel-rooms.mts';

// Strip `--flags` (e.g. --force) before positional destructuring so a flag
// can't be mistaken for the optional baseSettings path.
const [voxelJsonArg, outArg, propertyId, baseArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!voxelJsonArg || !outArg || !propertyId) {
    console.error('usage: tsx derive-settings.mts <scene.voxel.json> <out/settings.json> <propertyId> [baseSettings.json]');
    process.exit(1);
}
const voxelJsonPath = resolve(voxelJsonArg);
const outPath = resolve(outArg);

// -- reuse the viewer's exact loader; polyfill fetch for local files ---------
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('file:')) {
        const { fileURLToPath } = await import('node:url');
        const p = fileURLToPath(url);
        return {
            ok: true,
            statusText: 'OK',
            json: async () => JSON.parse(readFileSync(p, 'utf8')),
            arrayBuffer: async () => {
                const b = readFileSync(p);
                return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
            }
        } as any;
    }
    return realFetch(input);
}) as typeof fetch;

const meta = JSON.parse(readFileSync(voxelJsonPath, 'utf8'));
const collision: VoxelCollision = await loadVoxelCollision(pathToFileURL(voxelJsonPath).href);

// -- geometry helpers --------------------------------------------------------
const RAY_MAX = 1000;
const EYE_HEIGHT = 1.6;          // standing eye height (m)
const PERSON_HALF = 0.9;         // half of a 1.8 m person
const PERSON_RADIUS = 0.3;

const g = meta.gridBounds;
const cx = (g.min[0] + g.max[0]) / 2;
const cz = (g.min[2] + g.max[2]) / 2;
const cyGuess = (g.min[1] + g.max[1]) / 2;

// floor via the viewer's own cylinder spawn (highest supported ground near centre)
const spawn = { x: 0, y: 0, z: 0 };
const walkable = findCylinderSpawn(collision, cx, cyGuess, cz, PERSON_HALF, PERSON_RADIUS, spawn);

let mode: 'walk' | 'fly' = 'walk';
if (!walkable) {
    // object scan / no standable floor → fly-camera spawn (sphere fit)
    mode = 'fly';
    findSphereSpawn(collision, cx, cyGuess, cz, PERSON_RADIUS, spawn);
}

const floorY = mode === 'walk' ? spawn.y : spawn.y - EYE_HEIGHT;
const eye = { x: spawn.x, y: (mode === 'walk' ? floorY + EYE_HEIGHT : spawn.y), z: spawn.z };

// ceiling straight up from the eye
const upHit = collision.queryRay(eye.x, eye.y, eye.z, 0, 1, 0, RAY_MAX);
const ceilingY = upHit ? upHit.y : g.max[1];

// horizontal room size: rays wall-to-wall through the eye (fallback: grid
// extent). `hit` records whether BOTH opposing walls were actually found — a
// miss (ray escaped to the grid bound) is a signal the carve isn't sealed on
// that axis, used by the spatial sanity gate below.
const axisSpan = (dx: number, dz: number, gridSpan: number): { span: number; hit: boolean } => {
    const a = collision.queryRay(eye.x, eye.y, eye.z, dx, 0, dz, RAY_MAX);
    const b = collision.queryRay(eye.x, eye.y, eye.z, -dx, 0, -dz, RAY_MAX);
    if (a && b) {
        return { span: Math.hypot(a.x - b.x, a.z - b.z), hit: true };
    }
    return { span: gridSpan, hit: false };
};
const gridX = g.max[0] - g.min[0];
const gridZ = g.max[2] - g.min[2];
const spanX = axisSpan(1, 0, gridX);
const spanZ = axisSpan(0, 1, gridZ);
const sizeX = spanX.span;
const sizeZ = spanZ.span;
const height = ceilingY - floorY;

// room segmentation (doorway-erosion connected components on the free-space
// slice at knee height) → per-room aerials + dollhouse dimension labels.
// Leak filter: an "external-fill" carve that leaked keeps huge outdoor blobs
// connected — anything implausibly large for a room is dropped, as are
// closet-sized slivers.
const segmented = segmentRooms(collision, g, floorY + 0.6, floorY);
const rooms = segmented.filter(r =>
    r.area >= 4 && r.area <= 250 && Math.max(r.extentX, r.extentZ) <= 25);
const droppedRooms = segmented.length - rooms.length;

// longest clear sightline in the XZ plane → hero target (capped so we don't aim
// the target far out an open window). Known-imperfect (can pick a window); the
// review gate confirms/re-picks. Honest, deterministic first pass.
const N_DIRS = 96;
let bestDist = -1, bestDx = 1, bestDz = 0;
for (let i = 0; i < N_DIRS; i++) {
    const a = (i / N_DIRS) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const hit = collision.queryRay(eye.x, eye.y, eye.z, dx, 0, dz, 50);
    const dist = hit ? Math.hypot(hit.x - eye.x, hit.z - eye.z) : 50;
    if (dist > bestDist) { bestDist = dist; bestDx = dx; bestDz = dz; }
}
const reach = Math.min(bestDist * 0.85, 6);
const target = { x: eye.x + bestDx * reach, y: eye.y, z: eye.z + bestDz * reach };

// aerial "Drohnen" overviews — THREE curated oblique overviews scaled to the
// carved room. A camera under a real ceiling (~2.5–3 m) can't rise far enough
// for a full straight-down top-down (that's what the ceiling-sliced dollhouse
// mode is for), so all three are ANGLED bird's-eye shots that read cleanly:
// two down the long axis from each end + one across the short axis from the
// side. droneY sits just under the ceiling; targets sit near the floor so the
// look-down angle is steep. Requires a sealed carve (external-fill) — on an
// unsealed voxel the "room" is the whole grid and these frame the exterior.
const droneY = Math.min(ceilingY - 0.3, floorY + Math.max(height * 0.85, 2.5));
const longIsX = sizeX >= sizeZ;
const L = Math.max(sizeX, sizeZ);          // extent along the long axis
const W = Math.min(sizeX, sizeZ);          // extent along the short (cross) axis
const lux = longIsX ? 1 : 0;               // long-axis unit vector (XZ)
const luz = longIsX ? 0 : 1;
const wux = longIsX ? 0 : 1;               // cross-axis unit vector (XZ)
const wuz = longIsX ? 1 : 0;
const END = 0.42;                          // position near a room end
const CROSS = 0.18;                        // target slightly past centre
const SIDE = 0.34;                         // cross-view camera offset (stays off the wall)

// One oblique bird's-eye per room: camera near a room end (long axis) at
// droneY looking down past the room centre. The camera XZ is verified to be
// INSIDE the room's free space (walk-height probe) — offsets shrink toward
// the centre until one fits, so a camera never ends up inside a wall.
const roomAerial = (r: RoomSegment) => {
    const rcx = r.center[0], rcz = r.center[2];
    const rLongX = r.extentX >= r.extentZ;
    const rL = Math.max(r.extentX, r.extentZ);
    const ux = rLongX ? 1 : 0, uz = rLongX ? 0 : 1;
    let camX = rcx, camZ = rcz;
    for (const off of [END, -END, 0.3, -0.3, 0.18, -0.18, 0]) {
        const x = rcx + ux * rL * off, z = rcz + uz * rL * off;
        if (collision.isFreeAt(x, floorY + 1.0, z)) { camX = x; camZ = z; break; }
    }
    // target slightly past the centre, along camera→centre
    const dx = rcx - camX, dz = rcz - camZ;
    const dl = Math.hypot(dx, dz) || 1;
    const tx = rcx + (dx / dl) * rL * CROSS, tz = rcz + (dz / dl) * rL * CROSS;
    const fov = Math.round(Math.min(92, Math.max(60, 55 + rL * 4)));  // wider for bigger rooms
    return {
        position: [round(camX), round(droneY), round(camZ)],
        target: [round(tx), round(floorY + 0.2), round(tz)],
        fov
    };
};

const aerialViews = rooms.length >= 2 ? rooms.map(roomAerial) : [
    {   // wide, angled from one end of the long axis
        position: [round(cx + lux * L * END), round(droneY), round(cz + luz * L * END)],
        target: [round(cx - lux * L * CROSS), round(floorY + 0.2), round(cz - luz * L * CROSS)],
        fov: 95
    },
    {   // angled from the side (short axis) — the third distinct overview angle,
        // replacing a straight top-down that a low ceiling can't frame
        position: [round(cx + wux * W * SIDE), round(droneY), round(cz + wuz * W * SIDE)],
        target: [round(cx - wux * W * CROSS), round(floorY + 0.2), round(cz - wuz * W * CROSS)],
        fov: 92
    },
    {   // wide, angled from the other end
        position: [round(cx - lux * L * END), round(droneY), round(cz - luz * L * END)],
        target: [round(cx + lux * L * CROSS), round(floorY + 0.2), round(cz + luz * L * CROSS)],
        fov: 95
    }
];

// settings.rooms — dollhouse dimension labels (v2 `rooms`, cast-through):
// bbox-rectangle perimeter at floor level per detected room.
const settingsRooms = rooms.map((r, i) => {
    const { minX, maxX, minZ, maxZ } = r.bbox;
    const y = round(floorY);
    const c = (x: number, z: number) => [round(x), y, round(z)];
    return {
        name: `Raum ${i + 1}`,
        center: [round(r.center[0]), y, round(r.center[2])],
        lines: [
            { a: c(minX, minZ), b: c(maxX, minZ) },
            { a: c(maxX, minZ), b: c(maxX, maxZ) },
            { a: c(maxX, maxZ), b: c(minX, maxZ) },
            { a: c(minX, maxZ), b: c(minX, minZ) }
        ],
        area: r.area
    };
});

const roomFacts = {
    propertyId,
    mode,
    floorY: round(floorY),
    ceilingY: round(ceilingY),
    heightM: round(height),
    lengthM: round(Math.max(sizeX, sizeZ)),
    widthM: round(Math.min(sizeX, sizeZ)),
    center: [round(cx), round(floorY), round(cz)],
    voxelResolution: collision.voxelResolution
};

// -- assemble settings (base template minus all scan-specific spatial content) -
const baseSettingsPath = baseArg ? resolve(baseArg) : null;
const base = baseSettingsPath ? JSON.parse(readFileSync(baseSettingsPath, 'utf8')) : minimalBase();

const settings = {
    ...base,
    cameras: [{ initial: { position: [round(eye.x), round(eye.y), round(eye.z)], target: [round(target.x), round(target.y), round(target.z)], fov: 80 } }],
    aerialViews,
    rooms: settingsRooms,
    annotations: [],
    animTracks: [],
    pois: [],
    annotationMarkers: 'hidden',
    startMode: 'default',
    // per-property wiring; blank the demo's scan-specific bits
    staging: base.staging ? { ...base.staging, enabled: false, propertyId, styles: [] } : undefined,
    analytics: base.analytics ? { ...base.analytics, propertyId } : undefined,
    concierge: base.concierge ? { ...base.concierge, propertyId, greeting: undefined } : undefined
};
if (!settings.staging) delete settings.staging;
if (!settings.concierge) delete settings.concierge;

// -- spatial sanity gate: catch an unsealed / leaked carve -------------------
// validateV2 only checks the settings STRUCTURE. An unsealed carve floods free
// space across the whole grid, so the spawn ends up in open space (wall/ceiling
// rays escape to the grid bounds) and the derived m² + start camera are wrong —
// yet the structure is valid, so it would ship silently. A real sealed interior
// spawn always has walls on both axes and a ceiling overhead; when none of that
// is found, the carve is almost certainly leaked. Fly/object scans legitimately
// have no walls, so this gate only applies to walk scans. `--force` overrides.
if (mode === 'walk') {
    const openHoriz = !spanX.hit && !spanZ.hit; // no walls found on EITHER axis
    const openCeiling = !upHit;                 // no ceiling above the spawn
    const nearGrid = (v: number, grid: number) => grid > 0 && v >= grid * 0.92;
    const roomFillsGrid = nearGrid(sizeX, gridX) && nearGrid(sizeZ, gridZ);

    const fatal: string[] = [];
    if (openHoriz && openCeiling) {
        fatal.push('spawn sits in open space — no walls on either axis AND no ceiling above it');
    }
    if (roomFillsGrid && openCeiling) {
        fatal.push('derived room extent ≈ the full voxel grid with no ceiling overhead');
    }
    // Informative, not fatal (a genuinely huge open-plan space can also trip it).
    if (segmented.length > 0 && rooms.length === 0) {
        console.warn(`⚠ voxel sanity: all ${segmented.length} segmented region(s) were dropped by the size/leak filter — no valid room detected (m² will be missing).`);
    }
    // Walls found but no ceiling: height silently fell back to the grid bound
    // (line 88) and would feed a wrong "Deckenhöhe" answer. Not fatal (very high
    // ceilings / a gap in the ceiling splat happen), but warn loudly.
    if (openCeiling && !openHoriz) {
        console.warn(`⚠ voxel sanity: no ceiling found above the spawn — the derived height (${round(height)} m) fell back to the grid bound and is unreliable.`);
    }

    if (fatal.length) {
        console.error('\n✗ voxel sanity gate FAILED — this carve looks unsealed / leaked:');
        for (const f of fatal) console.error(`  - ${f}`);
        console.error('\nThe m² and start camera derived from it would be wrong. Re-run the carve');
        console.error('with --voxel-external-fill (seal the exterior) + --voxel-carve, or pass');
        console.error('--force to write these settings anyway.\n');
        if (!process.argv.includes('--force')) process.exit(1);
        console.warn('… --force set: writing anyway despite the sanity-gate failure.\n');
    }
}

// -- validate with the VIEWER'S OWN validator before writing -----------------
validateV2(settings);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(settings, null, 2));
const factsPath = outPath.replace(/settings\.json$/, 'room-facts.json');
writeFileSync(factsPath, JSON.stringify(roomFacts, null, 2));

console.log('=== derived geometry (headless, viewer collision code) ===');
console.log(`mode:      ${mode}${walkable ? '' : ' (no standable floor — object/fly scan)'}`);
console.log(`floor Y:   ${roomFacts.floorY}   ceiling Y: ${roomFacts.ceilingY}   height: ${roomFacts.heightM} m`);
console.log(`room:      ${roomFacts.lengthM} m × ${roomFacts.widthM} m × ${roomFacts.heightM} m (L×W×H)`);
console.log(`start cam: pos [${settings.cameras[0].initial.position}]  ->  target [${settings.cameras[0].initial.target}]`);
console.log(`rooms:     ${rooms.length} detected${droppedRooms ? ` (${droppedRooms} dropped by leak/size filter)` : ''}`);
rooms.forEach((r, i) => console.log(`  [${i}] area=${r.area}m²  center=[${r.center}]  extent=${r.extentX}×${r.extentZ}m  bbox x[${r.bbox.minX},${r.bbox.maxX}] z[${r.bbox.minZ},${r.bbox.maxZ}]`));
console.log(rooms.length >= 2
    ? `aerials:   ${aerialViews.length} views (one oblique bird's-eye per room)`
    : `aerials:   ${aerialViews.length} views (front / side / back — single room), long axis = ${longIsX ? 'X' : 'Z'}`);
aerialViews.forEach((a, i) => console.log(`  [${i}] pos [${a.position}] -> target [${a.target}] fov ${a.fov}`));
console.log(`\n✓ validateV2 passed`);
console.log(`settings:   ${outPath}`);
console.log(`room-facts: ${factsPath}`);

function round(n: number): number { return Math.round(n * 1000) / 1000; }

function minimalBase() {
    return {
        version: 2,
        tonemapping: 'none',
        highPrecisionRendering: false,
        background: { color: [0.05, 0.05, 0.06] },
        postEffectSettings: { sharpness: { enabled: true, amount: 0.7 } },
        animTracks: [],
        cameras: [],
        annotations: [],
        startMode: 'default'
    };
}
