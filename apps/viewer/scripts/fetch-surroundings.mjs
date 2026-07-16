#!/usr/bin/env node
/**
 * Build-time surroundings fetcher — run ONCE per property, never in the browser.
 *
 * Finds the nearest point of interest per category around a property
 * (Overpass/OpenStreetMap) and computes the real walking route + minutes to
 * each (OSRM foot profile, routing.openstreetmap.de). Prints a finished
 * `surroundings` block for settings.json; --kb prints the compact variant for
 * the concierge knowledge base (no route geometry — the model only needs
 * names and walking minutes).
 *
 * Usage:
 *   node scripts/fetch-surroundings.mjs --lat 53.5895 --lng 9.9838 [--radius 900] [--kb]
 *
 * Both upstreams are free public services; a one-off build-time run per
 * property is well within their fair-use terms. Route coordinates are rounded
 * to 5 decimals (~1 m) to keep settings.json small.
 */

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key.slice(2), next);
    i++;
  } else {
    args.set(key.slice(2), 'true');
  }
}

const lat = Number.parseFloat(args.get('lat') ?? '');
const lng = Number.parseFloat(args.get('lng') ?? '');
const radius = Number.parseInt(args.get('radius') ?? '900', 10);
const kbMode = args.get('kb') === 'true';

if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error('Usage: node scripts/fetch-surroundings.mjs --lat <lat> --lng <lng> [--radius m] [--kb]');
  process.exit(1);
}

// One entry per chip in the viewer. `filter` is an Overpass tag selector; the
// nearest match within the radius wins. Labels are what the guest reads.
const CATEGORIES = [
  { id: 'supermarkt', label: 'Supermarkt', filter: '[shop=supermarket]' },
  { id: 'baecker', label: 'Bäckerei', filter: '[shop=bakery]' },
  { id: 'bahn', label: 'U-Bahn', filter: '[railway=station]' },
  { id: 'schule', label: 'Schule', filter: '[amenity=school]' },
  { id: 'kita', label: 'Kita', filter: '[amenity=kindergarten]' },
  { id: 'apotheke', label: 'Apotheke', filter: '[amenity=pharmacy]' },
  { id: 'park', label: 'Park', filter: '[leisure=park]' },
  { id: 'cafe', label: 'Café', filter: '[amenity=cafe]' },
];

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSRM = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

/** Great-circle distance in meters — good enough to pick the nearest candidate. */
function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function overpassNearest(filter) {
  // nwr = nodes, ways, relations; `out center` folds ways/relations to one
  // point. NOTE: no result-count after `center` — overpass-api.de's WAF
  // answers 406 to `out center 30;`. The radius bounds the result set anyway.
  const query = `[out:json][timeout:25];nwr(around:${radius},${lat},${lng})${filter};out center;`;
  let res;
  for (let attempt = 0; ; attempt++) {
    // Headers matter here: overpass-api.de answers 406 to URLSearchParams
    // bodies (their WAF dislikes the `;charset=UTF-8` content-type suffix),
    // and their usage policy asks for an identifying User-Agent.
    res = await fetch(OVERPASS, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'innsyn-surroundings/1.0 (build-time, once per property)',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    // 429 = rate-limited, 5xx = busy: back off and retry (build-time script,
    // patience is free).
    if (!(res.status === 429 || res.status >= 500) || attempt >= 3) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = await res.json();
  let best = null;
  for (const el of data.elements ?? []) {
    const pLat = el.lat ?? el.center?.lat;
    const pLng = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (pLat === undefined || pLng === undefined || !name) continue;
    const dist = haversine(lat, lng, pLat, pLng);
    if (!best || dist < best.dist) best = { name, lat: pLat, lng: pLng, dist };
  }
  return best;
}

async function walkingRoute(toLat, toLng) {
  const url = `${OSRM}/${lng},${lat};${toLng},${toLat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;
  return {
    minutes: Math.max(1, Math.round(route.duration / 60)),
    meters: Math.round(route.distance),
    coordinates: route.geometry.coordinates.map(([x, y]) => [
      Math.round(x * 1e5) / 1e5,
      Math.round(y * 1e5) / 1e5,
    ]),
  };
}

const pois = [];
for (const cat of CATEGORIES) {
  try {
    const hit = await overpassNearest(cat.filter);
    if (!hit) {
      console.error(`  (kein Treffer für ${cat.label} im Umkreis von ${radius} m)`);
      continue;
    }
    const route = await walkingRoute(hit.lat, hit.lng);
    if (!route) {
      console.error(`  (keine Fußroute zu ${hit.name})`);
      continue;
    }
    pois.push({
      id: cat.id,
      label: cat.label,
      name: hit.name,
      lngLat: [Math.round(hit.lng * 1e5) / 1e5, Math.round(hit.lat * 1e5) / 1e5],
      walkMinutes: route.minutes,
      walkMeters: route.meters,
      route: route.coordinates,
    });
    console.error(`  ${cat.label}: ${hit.name} — ${route.minutes} min (${route.meters} m)`);
    // Be a polite client: pause between upstream calls.
    await new Promise((r) => setTimeout(r, 2500));
  } catch (err) {
    console.error(`  ${cat.label}: FEHLER ${err.message}`);
  }
}

if (kbMode) {
  // Knowledge-base variant: the model needs names + minutes, not geometry.
  const kb = pois.map((p) => ({
    id: p.id,
    label: p.label,
    name: p.name,
    walkMinutes: p.walkMinutes,
  }));
  console.log(JSON.stringify({ surroundings: kb }, null, 2));
} else {
  console.log(
    JSON.stringify(
      { surroundings: { center: [lng, lat], pois } },
      null,
      2,
    ),
  );
}
