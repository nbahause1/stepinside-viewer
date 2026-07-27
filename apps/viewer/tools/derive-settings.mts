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
import { segmentRooms } from './segment-rooms.mts';

const [voxelJsonArg, outArg, propertyId, baseArg] = process.argv.slice(2);
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

// horizontal room size: rays wall-to-wall through the eye (fallback: grid extent)
const axisSpan = (dx: number, dz: number, gridSpan: number) => {
    const a = collision.queryRay(eye.x, eye.y, eye.z, dx, 0, dz, RAY_MAX);
    const b = collision.queryRay(eye.x, eye.y, eye.z, -dx, 0, -dz, RAY_MAX);
    if (a && b) {
        return Math.hypot(a.x - b.x, a.z - b.z);
    }
    return gridSpan;
};
const sizeX = axisSpan(1, 0, g.max[0] - g.min[0]);
const sizeZ = axisSpan(0, 1, g.max[2] - g.min[2]);
const height = ceilingY - floorY;

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

// aerial "Drohnen" overviews — THREE curated views scaled to the carved room,
// matching the viewer's own bbox fallback pattern (camera-manager.ts): two wide
// angled views from each end of the long axis + one top-down centre. Emitting
// these replaces the viewer's demo-tuned fallback with room-fitted values.
const droneY = Math.min(ceilingY - 0.3, floorY + Math.max(height * 0.85, 2.5));
const longIsX = sizeX >= sizeZ;
const L = Math.max(sizeX, sizeZ);          // extent along the long axis
const lux = longIsX ? 1 : 0;               // long-axis unit vector (XZ)
const luz = longIsX ? 0 : 1;
const END = 0.42;                          // position near a room end
const CROSS = 0.18;                        // target slightly past centre
const aerialViews = [
    {   // wide, from one end of the long axis
        position: [round(cx + lux * L * END), round(droneY), round(cz + luz * L * END)],
        target: [round(cx - lux * L * CROSS), round(floorY + 0.2), round(cz - luz * L * CROSS)],
        fov: 95
    },
    {   // top-down centre (the one that reads as "Raum von oben")
        position: [round(cx), round(droneY), round(cz)],
        target: [round(cx), round(floorY), round(cz)],
        fov: 92
    },
    {   // wide, from the other end
        position: [round(cx - lux * L * END), round(droneY), round(cz - luz * L * END)],
        target: [round(cx + lux * L * CROSS), round(floorY + 0.2), round(cz + luz * L * CROSS)],
        fov: 95
    }
];

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

// -- dollhouse footprint + clip (segment-rooms.mts) -------------------------
// Room DIMENSIONS (settings.rooms with names) are authored MANUALLY per property
// with the viewer's measure tool (roomEntry()), exactly like highlights — auto-
// deriving accurate wall lengths from a noisy, non-axis-aligned scan is
// unreliable on open/L-shaped flats (a bounding box overstates the room; a traced
// wall outline comes out jagged). So we ship NO named rooms by default: the
// room-dimensions overlay requires a truthy `name` (room-dimensions.ts:34), so a
// nameless entry never draws a single measurement.
//
// We DO still emit ONE NAMELESS whole-flat footprint rectangle: the dollhouse
// cutaway reads rooms[].lines to crop XZ outliers REGARDLESS of name
// (dollhouse.ts resolveFootprint / resolveFloorY), so the cutaway keeps spanning
// the whole flat. When the user authors real rooms later, those NAMED entries sit
// alongside this one — dimensions then draw for the named rooms; the footprint is
// the union of everything, unchanged. clipY comes from the segmented ceilings.
const seg = mode === 'walk' ? segmentRooms(collision, { gridBounds: g, floorY }) : null;
let rooms: any[] = [];
if (seg && seg.rooms.length) {
    const minX = Math.min(...seg.rooms.map(r => r.minX)), maxX = Math.max(...seg.rooms.map(r => r.maxX));
    const minZ = Math.min(...seg.rooms.map(r => r.minZ)), maxZ = Math.max(...seg.rooms.map(r => r.maxZ));
    const fy = round(floorY);
    // NO `name`/`center`/`area` on purpose → room-dimensions.ts filters this out
    // (draws nothing); dollhouse footprint still uses these lines to crop.
    rooms = [{
        lines: [
            { a: [round(minX), fy, round(minZ)], b: [round(maxX), fy, round(minZ)] },
            { a: [round(maxX), fy, round(minZ)], b: [round(maxX), fy, round(maxZ)] },
            { a: [round(maxX), fy, round(maxZ)], b: [round(minX), fy, round(maxZ)] },
            { a: [round(minX), fy, round(maxZ)], b: [round(minX), fy, round(minZ)] }
        ]
    }];
}

// dollhouse cutaway height: from segmentation (below the lowest room ceiling),
// else a single-ray fallback for fly/object scans.
const clipY = seg ? round(seg.clipY) : round(Math.max(floorY + height * 0.5, ceilingY - 0.4));

// -- assemble settings (base template minus all scan-specific spatial content) -
const baseSettingsPath = baseArg ? resolve(baseArg) : null;
const base = baseSettingsPath ? JSON.parse(readFileSync(baseSettingsPath, 'utf8')) : minimalBase();

const settings = {
    ...base,
    cameras: [{ initial: { position: [round(eye.x), round(eye.y), round(eye.z)], target: [round(target.x), round(target.y), round(target.z)], fov: 80 } }],
    aerialViews,
    annotations: [],
    animTracks: [],
    pois: [],
    annotationMarkers: 'hidden',
    startMode: 'default',
    // derived spatial content (bird's-eye measurements + dollhouse cutaway)
    rooms,
    dollhouse: { ...(base.dollhouse ?? {}), clipY },
    // per-property wiring; blank the demo's scan-specific bits
    staging: base.staging ? { ...base.staging, enabled: false, propertyId, styles: [] } : undefined,
    analytics: base.analytics ? { ...base.analytics, propertyId } : undefined,
    // never inherit the demo broker card — blank contact so no wrong name/phone/exposé shows
    concierge: base.concierge
        ? { ...base.concierge, propertyId, greeting: undefined, contact: { name: '', phone: '', email: '', url: '', exposeUrl: '' } }
        : undefined,
    // never inherit the demo lead inbox — the in-viewer lead form (analytics.endpoint, kept)
    // still routes by propertyId, so blanking email/url only drops the mailto fallback
    inquiry: base.inquiry ? { ...base.inquiry, email: '', url: '' } : undefined
};
if (!settings.staging) delete settings.staging;
if (!settings.concierge) delete settings.concierge;
if (!settings.inquiry) delete settings.inquiry;
// never inherit the demo location: surroundings.ts reveals the map pill on `center`
// ALONE (not on POIs), so a [0,0] sentinel would open a map of open ocean. Remove it
// entirely — the pill stays hidden until a human runs fetch-surroundings.mjs for this
// property (see NEEDS-CONFIG.md).
delete settings.surroundings;

// -- validate with the VIEWER'S OWN validator before writing -----------------
validateV2(settings);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(settings, null, 2));
const factsPath = outPath.replace(/settings\.json$/, 'room-facts.json');
writeFileSync(factsPath, JSON.stringify(roomFacts, null, 2));

// -- NEEDS-CONFIG manifest (what geometry can't derive) ----------------------
// Local-only sidecars (a checklist of the per-property wiring a human must do
// before go-live). NOT an upload target — upload-scan.mjs must not ship these.
type NeedsItem = { id: string; field: string; status: string; blocking: boolean; why: string; fix: string };
const items: NeedsItem[] = [];
if (base.concierge?.contact && (base.concierge.contact.name || base.concierge.contact.email)) {
    items.push({ id: 'concierge-contact', field: 'settings.json concierge.contact + greeting', status: 'inherited-demo', blocking: true,
        why: 'Demo broker contact inherited from the base template; neutralized to empty.',
        fix: `Edit ${outPath} → concierge.contact (name/phone/email/exposeUrl) + concierge.greeting` });
}
if (base.surroundings?.center) {
    items.push({ id: 'surroundings', field: 'settings.json surroundings', status: 'inherited-demo', blocking: true,
        why: 'Demo location removed (map would centre on it). No map pill until set.',
        fix: `node apps/viewer/scripts/fetch-surroundings.mjs --lat <lat> --lng <lng>  → paste into ${outPath} surroundings` });
}
if (base.inquiry?.email) {
    items.push({ id: 'inquiry-email', field: 'settings.json inquiry.email', status: 'inherited-demo', blocking: false,
        why: 'Demo mailto inbox removed. The in-viewer lead form still routes by propertyId; email is only the mailto fallback.',
        fix: `Edit ${outPath} → inquiry.email (real mailto fallback recipient)` });
}
items.push({ id: 'lead-webhook', field: 'D1 properties.lead_webhook_url', status: 'unknown', blocking: true,
    why: 'Without a property row + webhook, hot leads forward to the global inbox with no broker attribution (or nowhere).',
    fix: `cd apps/concierge-api && node scripts/register-property.mjs ${propertyId} "<Label>" <owner-email> <https-webhook-url>` });
items.push({ id: 'concierge-kb', field: `apps/concierge-api/knowledge/${propertyId}.json`, status: 'missing', blocking: true,
    why: 'Concierge has no property facts until a knowledge base is authored, imported in worker.ts and redeployed.',
    fix: `Author apps/concierge-api/knowledge/${propertyId}.json, register it in worker.ts, redeploy` });
items.push({ id: 'room-dimensions', field: 'settings.json rooms (named entries)', status: 'manual', blocking: false,
    why: 'Room DIMENSIONS are authored manually per property (like highlights) — auto-derivation is unreliable on open/L-shaped flats. The dollhouse cutaway already spans the whole flat from a nameless footprint entry; no measurement labels show until you author rooms.',
    fix: 'In the viewer, stand in a room and run roomEntry() (measure tool) to append a NAMED rooms[] entry; repeat per room. Empty is a valid launch state.' });
items.push({ id: 'highlights', field: 'settings.json annotations', status: 'empty', blocking: false,
    why: 'Highlights are authored manually; empty is a valid launch state.',
    fix: 'Author in the viewer annotation tool when ready (each links a camera move).' });

const versionSeg = (outPath.match(/[\/\\](v\d+)[\/\\]/) || [])[1] ?? null;
const goLiveBlocked = items.some(i => i.blocking);
const manifest = { propertyId, version: versionSeg, generatedAt: new Date().toISOString(), goLiveBlocked, items };
const manifestPath = outPath.replace(/settings\.json$/, 'needs-config.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const mdPath = outPath.replace(/settings\.json$/, 'NEEDS-CONFIG.md');
const mdLine = (i: NeedsItem) => `- [ ] **${i.field}**\n      ${i.why}\n      → ${i.fix}`;
const md = [
    `# NEEDS-CONFIG — ${propertyId}${versionSeg ? ` / ${versionSeg}` : ''}`,
    ``,
    `Geometry is derived automatically. The items below need a human before go-live.`,
    ``,
    `## BLOCKING (leads / concierge / map are wrong or dead without these)`,
    ...items.filter(i => i.blocking).map(mdLine),
    ``,
    `## OPTIONAL`,
    ...items.filter(i => !i.blocking).map(mdLine),
    ``,
    `Derived automatically (no action): start camera, 3 aerial views, room L×W×H + floor-plan, dollhouse clip, collision.`,
    ``
].join('\n');
writeFileSync(mdPath, md);

// -- placeholder-leak guard --------------------------------------------------
// The resets above already neutralize the leaks; this makes a go-live gate
// possible. WARN by default (these fields are un-derivable); --strict fails loud.
const inheritedLeaks = items.filter(i => i.status === 'inherited-demo').map(i => i.id);
if (inheritedLeaks.length) {
    const msg = `inherited demo values neutralized: ${inheritedLeaks.join(', ')} — fill before go-live, see ${mdPath}`;
    if (process.env.SI_STRICT === '1' || process.argv.includes('--strict')) {
        console.error(`✗ ${msg}`);
        process.exit(1);
    }
    console.warn(`⚠ ${msg}`);
}

console.log('=== derived geometry (headless, viewer collision code) ===');
console.log(`mode:      ${mode}${walkable ? '' : ' (no standable floor — object/fly scan)'}`);
console.log(`floor Y:   ${roomFacts.floorY}   ceiling Y: ${roomFacts.ceilingY}   height: ${roomFacts.heightM} m`);
console.log(`room:      ${roomFacts.lengthM} m × ${roomFacts.widthM} m × ${roomFacts.heightM} m (L×W×H)`);
console.log(`start cam: pos [${settings.cameras[0].initial.position}]  ->  target [${settings.cameras[0].initial.target}]`);
console.log(`aerials:   ${aerialViews.length} views (front / top-down / back), long axis = ${longIsX ? 'X' : 'Z'}`);
aerialViews.forEach((a, i) => console.log(`  [${i}] pos [${a.position}] -> target [${a.target}] fov ${a.fov}`));
console.log(`rooms:     ${seg ? `${seg.rooms.length} segmented → 1 nameless dollhouse footprint (dimensions authored manually)` : '[] (no footprint)'}   dollhouse clipY: ${clipY}`);
console.log(`\n✓ validateV2 passed`);
console.log(`settings:     ${outPath}`);
console.log(`room-facts:   ${factsPath}`);
console.log(`needs-config: ${manifestPath}`);
console.log(`checklist:    ${mdPath}${goLiveBlocked ? '  ⚠ go-live BLOCKED until filled' : ''}`);

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
