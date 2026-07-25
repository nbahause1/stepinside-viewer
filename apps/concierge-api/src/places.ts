/**
 * find_place tool executor — the concierge's live place lookup.
 *
 * When a visitor asks about a place that is NOT in the property's curated
 * `surroundings` list ("Wo ist der nächste MediaMarkt?"), the model calls the
 * find_place tool and this module answers it: Photon (OSM geocoder) finds
 * matching places near the property, the nearest hit gets real walking and
 * driving minutes via OSRM. Both are free OSM services; one lookup per
 * concierge question is well within fair use.
 *
 * Grounding property: the model only ever sees data returned from here — it
 * can name a place and its minutes, but cannot invent either. The caller
 * relays `lngLat` to the viewer so the neighbourhood map can draw the route
 * (the coordinates themselves never enter the model's context).
 */

const PHOTON_ENDPOINT = 'https://photon.komoot.io/api';
// Primary + mirror: the public Overpass instances are community-run and
// individually rate-limited; trying the mirror turns "busy right now" into an
// answer instead of a broker fallback.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const OSRM_CAR = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';

/** Keep third-party lookups snappy: the visitor is waiting on a chat answer.
 *  Overpass is raced across two mirrors and OSRM degrades to null on failure,
 *  so they get the tight budget; a Photon geocode failure sinks the whole
 *  lookup, so the name/brand geocode gets a little more headroom. */
const LOOKUP_TIMEOUT_MS = 3500;
const PHOTON_TIMEOUT_MS = 5000;

/** Category search radius around the property, in meters. */
const CATEGORY_RADIUS_M = 3000;

/**
 * Category → Overpass tag filter. Photon is a NAME geocoder — it finds places
 * *called* "Fitnessstudio" anywhere in the country, not gyms nearby. Generic
 * "a kind of place" questions therefore go through Overpass instead. The keys
 * double as the tool's category enum (core.ts).
 */
export const PLACE_CATEGORIES: Record<string, string> = {
  fitnessstudio: '[leisure=fitness_centre]',
  restaurant: '[amenity=restaurant]',
  cafe: '[amenity=cafe]',
  bar: '[amenity=bar]',
  baeckerei: '[shop=bakery]',
  supermarkt: '[shop=supermarket]',
  drogerie: '[shop=chemist]',
  apotheke: '[amenity=pharmacy]',
  arzt: '[amenity=doctors]',
  zahnarzt: '[amenity=dentist]',
  kita: '[amenity=kindergarten]',
  schule: '[amenity=school]',
  spielplatz: '[leisure=playground]',
  park: '[leisure=park]',
  bank: '[amenity=bank]',
  geldautomat: '[amenity=atm]',
  post: '[amenity=post_office]',
  tankstelle: '[amenity=fuel]',
  friseur: '[shop=hairdresser]',
};

export interface FoundPlace {
  /** Display name ("MediaMarkt"). */
  name: string;
  /** Street address ("Nedderfeld 70, 22529 Hamburg"), may be ''. */
  address: string;
  lngLat: [number, number];
  walkMinutes: number | null;
  driveMinutes: number | null;
  /** Straight-line distance in meters (fallback context for the model). */
  distanceMeters: number;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

async function fetchJson(url: string, timeoutMs: number = LOOKUP_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'innsyn-concierge/1.0 (place lookup, one per chat question)' },
  });
  if (!res.ok) {
    throw new Error(`upstream ${res.status}`);
  }
  return res.json();
}

async function routeMinutes(
  endpoint: string,
  from: { lng: number; lat: number },
  to: [number, number],
): Promise<number | null> {
  try {
    const data = (await fetchJson(
      `${endpoint}/${from.lng},${from.lat};${to[0]},${to[1]}?overview=false`,
    )) as { routes?: { duration: number }[] };
    const duration = data.routes?.[0]?.duration;
    return typeof duration === 'number' ? Math.max(1, Math.round(duration / 60)) : null;
  } catch {
    // Routing is enrichment; a failed profile must not sink the whole lookup.
    return null;
  }
}

/** Nearest place of a known CATEGORY via Overpass (real around-search). */
async function findByCategory(
  category: string,
  location: { lng: number; lat: number },
): Promise<FoundPlace | null> {
  const filter = PLACE_CATEGORIES[category];
  if (!filter) return null;
  // Header quirks matter: overpass-api.de's WAF rejects URLSearchParams
  // bodies (the `;charset=UTF-8` content-type suffix) and asks for an
  // identifying User-Agent. Same lesson as apps/viewer/scripts/fetch-surroundings.mjs.
  // Server-side query budget kept at/below the client abort (LOOKUP_TIMEOUT_MS)
  // so we never abort a response the server was still allowed to compute.
  const query = `[out:json][timeout:3];nwr(around:${CATEGORY_RADIUS_M},${location.lat},${location.lng})${filter};out center;`;
  // Race BOTH community mirrors in parallel and take the first that answers OK.
  // Previously they were tried serially: a slow/busy primary made the visitor
  // wait out its full timeout before the mirror was even attempted (up to ~2×
  // the timeout). Promise.any resolves on the first success and only rejects
  // (AggregateError) when every mirror fails.
  const fetchOverpass = async (endpoint: string): Promise<Response> => {
    const attempt = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'innsyn-concierge/1.0 (place lookup, one per chat question)',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!attempt.ok) throw new Error(`overpass ${attempt.status}`);
    return attempt;
  };
  let res: Response;
  try {
    res = await Promise.any(OVERPASS_ENDPOINTS.map(fetchOverpass));
  } catch (err) {
    const first = err instanceof AggregateError ? err.errors[0] : err;
    throw first instanceof Error ? first : new Error('overpass unavailable');
  }
  const data = (await res.json()) as {
    elements?: {
      lat?: number; lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }[];
  };

  let best: { name: string; address: string; lngLat: [number, number]; dist: number } | null = null;
  for (const el of data.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat === undefined || lng === undefined || !name) continue;
    const dist = haversineMeters([location.lng, location.lat], [lng, lat]);
    if (!best || dist < best.dist) {
      const address = [
        [el.tags?.['addr:street'], el.tags?.['addr:housenumber']].filter(Boolean).join(' '),
        [el.tags?.['addr:postcode'], el.tags?.['addr:city']].filter(Boolean).join(' '),
      ].filter((part) => part.length > 0).join(', ');
      best = { name, address, lngLat: [lng, lat], dist };
    }
  }
  if (!best) return null;

  const [walkMinutes, driveMinutes] = await Promise.all([
    routeMinutes(OSRM_FOOT, location, best.lngLat),
    routeMinutes(OSRM_CAR, location, best.lngLat),
  ]);
  return {
    name: best.name,
    address: best.address,
    lngLat: best.lngLat,
    walkMinutes,
    driveMinutes,
    distanceMeters: best.dist,
  };
}

/**
 * Find the nearest place matching `query` around `location`. When `category`
 * names a known kind of place, Overpass does a real around-search; otherwise
 * the query is treated as a name/brand and goes through Photon.
 * Returns null when nothing plausible was found; throws only on total
 * geocoder failure (the caller converts that into a tool error result).
 */
export async function findPlace(
  query: string,
  location: { lng: number; lat: number },
  category?: string,
): Promise<FoundPlace | null> {
  if (category && PLACE_CATEGORIES[category]) {
    return findByCategory(category, location);
  }
  const url =
    `${PHOTON_ENDPOINT}?q=${encodeURIComponent(query)}&lang=de&limit=5` +
    `&lat=${location.lat}&lon=${location.lng}`;
  const data = (await fetchJson(url, PHOTON_TIMEOUT_MS)) as {
    features?: {
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, unknown>;
    }[];
  };

  let best: { name: string; address: string; lngLat: [number, number]; dist: number } | null = null;
  for (const f of data.features ?? []) {
    const coords = f.geometry?.coordinates;
    const p = f.properties ?? {};
    const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : undefined;
    if (!coords || !name) continue;
    const dist = haversineMeters([location.lng, location.lat], coords);
    // Photon's location bias is soft — a brand query can still surface a
    // branch in another city. 30 km keeps it to "in der Gegend".
    if (dist > 30_000) continue;
    if (!best || dist < best.dist) {
      const address = [
        [p.street, p.housenumber].filter(Boolean).join(' '),
        [p.postcode, p.city ?? p.town ?? p.village].filter(Boolean).join(' '),
      ].filter((part) => part.length > 0).join(', ');
      best = { name, address, lngLat: coords, dist };
    }
  }
  if (!best) return null;

  const [walkMinutes, driveMinutes] = await Promise.all([
    routeMinutes(OSRM_FOOT, location, best.lngLat),
    routeMinutes(OSRM_CAR, location, best.lngLat),
  ]);

  return {
    name: best.name,
    address: best.address,
    lngLat: best.lngLat,
    walkMinutes,
    driveMinutes,
    distanceMeters: best.dist,
  };
}
