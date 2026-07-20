import { shieldFromViewer } from './dom-shield';
import type { Global } from './types';

// Neighbourhood map ("Umgebung"). A glass pill (bottom-left, above the
// concierge) opens a map overlay: the property as a marker plus an address
// search. The map stays deliberately empty — no preset pins, no suggestion
// chips — the guest asks for what THEY care about (typed address or a
// concierge question), and only then a route draws itself from the house to
// the place, with minutes at the destination. Preconfigured POIs (from
// settings.surroundings) remain as routing data for concierge answers only.
//
// MapLibre GL (~250 KB) is loaded via dynamic import() on FIRST open only, so
// the 3D viewer's startup cost is untouched. Everything is precomputed data
// from settings.surroundings (see scripts/fetch-surroundings.mjs); the browser
// talks to no geo service except the tile server.
//
// The concierge triggers the same flow through the event bus:
//   events.fire('surroundings:show', poiId)

type SurroundingsPoi = {
    id: string,
    label: string,
    name: string,
    lngLat: [number, number],
    walkMinutes: number,
    walkMeters?: number,
    route: [number, number][]
};

type SurroundingsSettings = {
    center: [number, number],
    styleUrl?: string,
    pois: SurroundingsPoi[]
};

// Default style: MapTiler "dataviz" (calm, light — reads like a paper map
// inside the dark glass frame). Licensed via the MapTiler-Free account; the
// key is a PUBLIC client-side key, protected by the account's allowed-origins
// list (myinnsyn.de, *.myinnsyn.de, localhost, *.vercel.app), so it is safe
// in the bundle. Per-scene override: settings.surroundings.styleUrl.
// See umgebungskarte-bauplan.md.
const DEFAULT_STYLE_URL = 'https://api.maptiler.com/maps/dataviz/style.json?key=EXxhuExYf1YqzB6AL5Bi';

// The maplibre stylesheet is copied to public/vendor/ by rollup; injected as a
// <link> alongside the dynamic import so neither ships with the viewer core.
const MAPLIBRE_CSS_HREF = 'vendor/maplibre-gl.css';

// Custom-address check: Photon (komoot) geocodes as the guest types, OSRM's
// foot profile routes house→address — both free OSM services, called live per
// lookup (unlike the precomputed POI chips). Fair use is fine at viewer scale;
// GO-LIVE NOTE: typed addresses reach these third-party services, so the
// Datenschutzerklärung must name them (or the calls move behind our worker).
const PHOTON_ENDPOINT = 'https://photon.komoot.io/api';
const OSRM_FOOT_ENDPOINT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
// Car: same OSRM instance, car profile. Times are free-flow (no live traffic).
const OSRM_CAR_ENDPOINT = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';
// Public transit: Transitous (open MOTIS instance over the official German
// DELFI timetables — covers HVV fully). `radius` makes stops around the raw
// coordinates usable as entry points (the instance's coordinate street-routing
// is unreliable); the missing first/last-mile walks are added via OSRM below
// so the shown door-to-door minutes stay honest.
const TRANSIT_PLAN_ENDPOINT = 'https://api.transitous.org/api/v6/plan';
const TRANSIT_STOP_RADIUS_M = 800;

const ROUTE_SOURCE = 'walkRoute';
const ROUTE_LAYER = 'walkRouteLine';
const ROUTE_CASING_LAYER = 'walkRouteCasing';
const ROUTE_DRAW_MS = 1400;

// The map's own accent: a quiet, deep brick red — reads like a route drawn on
// a printed map, calmer than the viewer's warm gold on the light Positron
// tiles. Mirrored in index.scss as --surroundings-accent (markers, chips);
// keep both in sync when tuning.
const MAP_ACCENT = '#8c3a2f';

const initSurroundings = (global: Global) => {
    const { settings, events, config, state } = global;

    const cfg = settings.surroundings as SurroundingsSettings | undefined;
    const pill = document.getElementById('surroundingsPill');
    const toggle = document.getElementById('surroundingsToggle');
    const overlay = document.getElementById('surroundingsOverlay');
    const closeBtn = document.getElementById('surroundingsClose');
    const mapHost = document.getElementById('surroundingsMap');
    const status = document.getElementById('surroundingsStatus');
    const searchInput = document.getElementById('surroundingsSearchInput') as HTMLInputElement | null;
    const searchResults = document.getElementById('surroundingsSearchResults');
    const modesRow = document.getElementById('surroundingsModes');
    if (!pill || !toggle || !overlay || !closeBtn || !mapHost || !status || !searchInput || !searchResults || !modesRow) return;

    // No data -> the whole module is an inert no-op (same guarantee as the
    // concierge: a misconfigured build never shows a dead button). Only the
    // property's location is required; POIs are optional concierge routing data.
    if (!cfg?.center) return;
    const allPois = Array.isArray(cfg.pois) ? cfg.pois : [];
    const pois = allPois.filter(p => p?.id && Array.isArray(p.lngLat) && Array.isArray(p.route) && p.route.length >= 2);

    pill.classList.remove('hidden');
    // hasInput: the address field's keystrokes must never reach the viewer's
    // global hotkeys (1/2/3, r, space…) — same shield as the concierge panel.
    shieldFromViewer(overlay, { hasInput: true });
    shieldFromViewer(pill);

    // -- state ---------------------------------------------------------------
    let open = false;
    // The maplibre namespace + map instance exist only after the first open.
    let maplibre: typeof import('maplibre-gl') | null = null;
    let map: import('maplibre-gl').Map | null = null;
    let mapReady = false;                        // style loaded, sources usable
    let loadFailed = false;
    let activePoiId: string | null = null;
    let pendingPoiId: string | null = null;      // selected before the map finished loading
    let drawFrame = 0;                           // rAF handle of the running route animation
    let walkLabel: import('maplibre-gl').Marker | null = null;
    // Destination marker: guest-searched address OR a concierge-answered POI —
    // there is at most one, and it exists only after an explicit request.
    let customMarker: import('maplibre-gl').Marker | null = null;


    // -- open/close ----------------------------------------------------------
    // The bottom-left corner rests as ONE bubble, not a stack: the map tucks
    // down behind the concierge while the visitor is moving and slides back out
    // shortly after the camera settles. Deliberately the same rhythm (and the
    // same debounce) as the highlights pill in ui.ts — hiding is immediate so
    // motion clears the screen at once, showing is debounced so a micro-pause
    // mid-look-around never makes it flicker. It never tucks while the map
    // itself is open, otherwise its own toggle would slide away under the hand.
    const TUCK_SETTLE_MS = 400;
    let tuckTimer: ReturnType<typeof setTimeout> | null = null;

    const updateTuck = () => {
        if (tuckTimer) {
            clearTimeout(tuckTimer);
            tuckTimer = null;
        }
        if (open) {
            pill.classList.remove('is-tucked');
            return;
        }
        if (!state.heroStill) {
            pill.classList.add('is-tucked');
            return;
        }
        tuckTimer = setTimeout(() => {
            tuckTimer = null;
            pill.classList.remove('is-tucked');
        }, TUCK_SETTLE_MS);
    };

    const setOpen = (next: boolean) => {
        if (open === next) return;
        open = next;
        overlay.classList.toggle('is-open', open);
        pill.classList.toggle('is-open', open);
        updateTuck();
        if (open) {
            bringMapFront();
            events.fire('analytics', 'surroundings', { action: 'open' });
            void ensureMap();
        }
    };

    events.on('heroStill:changed', updateTuck);
    updateTuck();

    // Layering dance with the concierge: the map (z 18) may overlap the chat
    // (z 16) — whichever panel was touched last wins the front. A tap anywhere
    // on the chat lifts it above the map (.is-front → z 19); touching or
    // opening the map hands the front back. Capture phase, so the panels'
    // own stopPropagation shields (dom-shield) don't swallow the signal.
    const chatPillEl = document.getElementById('chatPill');
    const bringMapFront = () => chatPillEl?.classList.remove('is-front');
    chatPillEl?.addEventListener('pointerdown', () => chatPillEl.classList.add('is-front'), true);
    overlay.addEventListener('pointerdown', bringMapFront, true);
    pill.addEventListener('pointerdown', bringMapFront, true);

    // The pin lives inside the chat panel's footprint — hide it while the
    // conversation is expanded so it never floats over the messages.
    events.on('chatOpen:changed', (chatOpen: boolean) => {
        pill.classList.toggle('is-chat-open', chatOpen);
    });

    toggle.addEventListener('click', () => setOpen(!open));
    closeBtn.addEventListener('click', () => setOpen(false));
    overlay.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
    });

    // -- map bootstrap (once, on first open) ----------------------------------
    const ensureMap = async () => {
        if (map || loadFailed) return;
        if (mapHost.dataset.loading === '1') return;
        mapHost.dataset.loading = '1';
        status.textContent = 'Karte lädt…';
        status.classList.remove('hidden');

        try {
            // CSS first (marker/control positioning depends on it), then the lib.
            if (!document.querySelector(`link[href="${MAPLIBRE_CSS_HREF}"]`)) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = MAPLIBRE_CSS_HREF;
                document.head.appendChild(link);
            }
            maplibre = await import('maplibre-gl');
        } catch (err) {
            console.warn('Surroundings map failed to load:', err);
            loadFailed = true;
            status.textContent = 'Karte konnte nicht geladen werden.';
            return;
        }

        map = new maplibre.Map({
            container: mapHost,
            style: cfg.styleUrl ?? DEFAULT_STYLE_URL,
            center: cfg.center,
            zoom: 14.5,
            attributionControl: { compact: true },
            // The overlay pans/zooms; rotation adds nothing to "where is the
            // supermarket" and fights one-finger gestures on the glass panel.
            dragRotate: false,
            pitchWithRotate: false
        });
        map.touchZoomRotate.disableRotation();

        // DEV: expose the map for tuning/diagnosis — devtools entry points only
        // (?debug / ?scout / ?record), never in the visitor path.
        if (config.devtools) {
            (window as unknown as Record<string, unknown>).surroundingsMap = map;
        }

        // MapLibre measures its container ONCE, at construction. If that
        // happens while the layout is transient (panel mid-entrance, or the
        // whole document briefly 0-wide during viewer startup) the canvas
        // keeps a stale/default size forever. Observing the container heals
        // every such case the moment real dimensions exist.
        new ResizeObserver(() => map?.resize()).observe(mapHost);

        // House marker: deep-red dot with a white ring (see MAP_ACCENT). The
        // only marker on the empty map — destinations appear per request.
        const houseEl = document.createElement('div');
        houseEl.className = 'surroundingsHouse';
        new maplibre.Marker({ element: houseEl }).setLngLat(cfg.center).addTo(map);

        map.on('load', () => {
            if (!map) return;
            map.addSource(ROUTE_SOURCE, {
                type: 'geojson',
                data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
            });
            // Two layers over the same source: a soft white casing under the
            // red line — the printed-map look, and it keeps the route legible
            // where it crosses dark buildings or park greens.
            map.addLayer({
                id: ROUTE_CASING_LAYER,
                type: 'line',
                source: ROUTE_SOURCE,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': '#ffffff',
                    'line-width': 7,
                    'line-opacity': 0.85
                }
            });
            map.addLayer({
                id: ROUTE_LAYER,
                type: 'line',
                source: ROUTE_SOURCE,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': MAP_ACCENT,
                    'line-width': 3.5,
                    'line-opacity': 0.95
                }
            });
            mapReady = true;
            status.classList.add('hidden');
            map.resize();   // container may have finished its entrance mid-boot
            const queued = pendingPoiId;
            const queuedPlace = pendingPlace;
            pendingPoiId = null;
            pendingPlace = null;
            if (queued) {
                selectPoi(queued);
            } else if (queuedPlace) {
                searchInput.value = queuedPlace.label;
                routeToAddress(queuedPlace);
            } else {
                fitAll(false);
            }
        });

        map.on('error', (e: unknown) => {
            // Tile/style errors surface here (e.g. provider down). Only fatal
            // before first render — afterwards missing tiles degrade gracefully.
            if (!mapReady) {
                console.warn('Surroundings map style failed:', e);
                status.textContent = 'Karte konnte nicht geladen werden.';
                status.classList.remove('hidden');
            }
        });
    };

    // -- camera helpers --------------------------------------------------------
    const boundsOf = (coords: [number, number][]) => {
        const b = new maplibre!.LngLatBounds(coords[0], coords[0]);
        for (const c of coords) b.extend(c);
        return b;
    };

    // Resting view: the property centred at neighbourhood zoom (no pins to
    // frame — the map starts empty by design).
    const fitAll = (animate: boolean) => {
        if (!map) return;
        map.easeTo({ center: cfg.center, zoom: 14.5, duration: animate ? 900 : 0 });
    };

    // -- route animation --------------------------------------------------------
    const setRoute = (coordinates: [number, number][]) => {
        const src = map?.getSource(ROUTE_SOURCE) as import('maplibre-gl').GeoJSONSource | undefined;
        src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
    };

    const clearWalkLabel = () => {
        walkLabel?.remove();
        walkLabel = null;
    };

    /**
     * Start the route draw once the camera flight has (roughly) settled.
     * `moveend` alone is NOT reliable: an interrupted flight or a stuck drag
     * state leaves the map "moving" forever and the event never fires — the
     * timer guarantees the draw happens either way (flight is 900 ms).
     */
    const armRouteDraw = (start: () => void) => {
        let fired = false;
        const fire = () => {
            if (fired) return;
            fired = true;
            start();
        };
        map!.once('moveend', fire);
        window.setTimeout(fire, 1100);
    };

    // Anything the camera can route to: a preconfigured POI or a guest-searched
    // address (which has no id/label, just geometry + minutes).
    type RouteTarget = {
        lngLat: [number, number],
        walkMinutes: number,
        route: [number, number][],
        // Destination-label text; POIs default to "X Min. zu Fuß".
        labelText?: string
    };

    /**
     * Draw the route progressively: each frame pushes the visible slice of the
     * geometry into the GeoJSON source, interpolating within the current
     * segment so the tip moves smoothly instead of jumping vertices.
     */
    const animateRoute = (poi: RouteTarget) => {
        cancelAnimationFrame(drawFrame);
        const route = poi.route;
        const start = performance.now();
        // ease-out: the line leaves the house quickly and settles at the target
        const ease = (t: number) => 1 - (1 - t) ** 3;

        const step = (now: number) => {
            const t = Math.min(1, (now - start) / ROUTE_DRAW_MS);
            const p = ease(t) * (route.length - 1);
            const whole = Math.floor(p);
            const frac = p - whole;
            const slice = route.slice(0, whole + 1);
            if (whole < route.length - 1 && frac > 0) {
                const [ax, ay] = route[whole];
                const [bx, by] = route[whole + 1];
                slice.push([ax + (bx - ax) * frac, ay + (by - ay) * frac]);
            }
            setRoute(slice);
            if (t < 1) {
                drawFrame = requestAnimationFrame(step);
            } else {
                // Arrival: minutes label at the destination.
                const el = document.createElement('div');
                el.className = 'surroundingsWalkLabel';
                el.textContent = poi.labelText ?? `${poi.walkMinutes} Min. zu Fuß`;
                walkLabel = new maplibre!.Marker({ element: el, anchor: 'bottom', offset: [0, -18] })
                    .setLngLat(poi.lngLat)
                    .addTo(map!);
            }
        };
        drawFrame = requestAnimationFrame(step);
    };

    // -- selection (concierge answers only — there are no pins or chips) ---------
    const selectPoi = (id: string) => {
        const poi = pois.find(p => p.id === id);
        if (!poi) return;
        if (!mapReady) {
            // Map still booting (e.g. concierge answered before first open) —
            // remember the wish; the load handler replays it.
            pendingPoiId = id;
            return;
        }
        activePoiId = id;
        // A POI selection replaces any searched-address state.
        searchTarget = null;
        modesRow.classList.add('hidden');
        // The destination gets a marker only now that it was explicitly asked for.
        customMarker?.remove();
        const destEl = document.createElement('div');
        destEl.className = 'surroundingsDest';
        destEl.title = poi.name;
        customMarker = new maplibre!.Marker({ element: destEl }).setLngLat(poi.lngLat).addTo(map!);
        clearWalkLabel();
        setRoute([]);
        cancelAnimationFrame(drawFrame);
        // Frame house + route + destination, then let the line draw itself.
        map!.fitBounds(boundsOf([cfg.center, ...poi.route, poi.lngLat]), {
            padding: { top: 70, bottom: 90, left: 60, right: 60 },
            duration: 900,
            maxZoom: 16.5
        });
        armRouteDraw(() => {
            if (activePoiId === id) animateRoute(poi);
        });
        events.fire('analytics', 'surroundings', { action: 'poi', poi: id });
    };

    // -- custom-address search ("wie weit zur Arbeit?") ---------------------------
    // Photon geocodes as the guest types (debounced, biased to the property's
    // location); picking a suggestion fetches the live walking route and plays
    // the same draw animation as the chips. Only the search EVENT is tracked,
    // never the typed address (privacy).

    type GeoHit = { label: string, detail: string, lngLat: [number, number] };

    let searchTimer = 0;
    let searchAbort: AbortController | null = null;
    let hits: GeoHit[] = [];

    const hideResults = () => {
        searchResults.classList.add('hidden');
        searchResults.textContent = '';
        hits = [];
    };

    const showMessage = (text: string) => {
        searchResults.textContent = '';
        const el = document.createElement('div');
        el.className = 'surroundingsSearchMsg';
        el.textContent = text;
        searchResults.appendChild(el);
        searchResults.classList.remove('hidden');
    };

    const renderResults = () => {
        searchResults.textContent = '';
        for (const hit of hits) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            const main = document.createElement('span');
            main.className = 'surroundingsHitLabel';
            main.textContent = hit.label;
            const sub = document.createElement('span');
            sub.className = 'surroundingsHitDetail';
            sub.textContent = hit.detail;
            btn.append(main, sub);
            btn.addEventListener('click', () => {
                hideResults();
                searchInput.value = hit.label;
                void routeToAddress(hit);
            });
            searchResults.appendChild(btn);
        }
        searchResults.classList.remove('hidden');
    };

    const geocode = async (query: string) => {
        searchAbort?.abort();
        searchAbort = new AbortController();
        try {
            // lat/lon bias ranks hits near the property first (a "Bahnhofstraße"
            // exists in every town — the guest means the one nearby).
            const url = `${PHOTON_ENDPOINT}?q=${encodeURIComponent(query)}&lang=de&limit=4` +
                `&lat=${cfg.center[1]}&lon=${cfg.center[0]}`;
            const res = await fetch(url, { signal: searchAbort.signal });
            if (!res.ok) throw new Error(`geocoder ${res.status}`);
            const data = await res.json() as {
                features?: {
                    geometry?: { coordinates?: [number, number] },
                    properties?: Record<string, unknown>
                }[]
            };
            // Photon often returns the same address several times (building +
            // address-point entities) — first hit per label+place wins.
            const seen = new Set<string>();
            hits = (data.features ?? []).flatMap((f) => {
                const coords = f.geometry?.coordinates;
                const p = f.properties ?? {};
                if (!coords) return [];
                const street = [p.street ?? p.name, p.housenumber].filter(Boolean).join(' ');
                const place = [p.postcode, p.city ?? p.town ?? p.village].filter(Boolean).join(' ');
                if (!street) return [];
                const key = `${street}|${place}`;
                if (seen.has(key)) return [];
                seen.add(key);
                return [{ label: street, detail: place, lngLat: coords }];
            });
            if (hits.length === 0) {
                showMessage('Keine Adresse gefunden.');
            } else {
                renderResults();
            }
        } catch (err) {
            if ((err as Error).name === 'AbortError') return;   // superseded by newer keystroke
            console.warn('Surroundings geocoding failed:', err);
            showMessage('Suche gerade nicht möglich.');
        }
    };

    // -- three travel modes for the searched address --------------------------
    // Walking and driving come from OSRM (two profiles of the same service);
    // transit from Transitous. Results land independently in the mode pills;
    // tapping a pill draws that mode's route.

    type TravelMode = 'walk' | 'car' | 'transit';
    // null = loading, 'none' = no connection found
    type ModeResult = RouteTarget | null | 'none';

    let searchTarget: GeoHit | null = null;
    let activeMode: TravelMode = 'walk';
    let modeResults: Record<TravelMode, ModeResult> = { walk: null, car: null, transit: null };

    /** Decode a Google-encoded polyline (MOTIS legGeometry) to [lng, lat] pairs. */
    const decodePolyline = (encoded: string, precision: number): [number, number][] => {
        const factor = 10 ** precision;
        const coords: [number, number][] = [];
        let index = 0;
        let lat = 0;
        let lng = 0;
        while (index < encoded.length) {
            for (const axis of [0, 1]) {
                let shift = 0;
                let result = 0;
                let byte;
                do {
                    byte = encoded.charCodeAt(index++) - 63;
                    result |= (byte & 0x1f) << shift;
                    shift += 5;
                } while (byte >= 0x20);
                const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
                if (axis === 0) lat += delta; else lng += delta;
            }
            coords.push([lng / factor, lat / factor]);
        }
        return coords;
    };

    /**
     * Departure time for the timetable query. "Wie komme ich zur Arbeit?" wants
     * a typical daytime connection — asking at 1 a.m. would return night buses.
     * Daytime (6-21h): now; otherwise: next morning 08:30.
     */
    const transitDepartureIso = (): string => {
        const d = new Date();
        const h = d.getHours();
        if (h >= 21 || h < 6) {
            d.setDate(d.getDate() + 1);
            d.setHours(8, 30, 0, 0);
        }
        return d.toISOString();
    };

    /** One OSRM leg (foot or car profile): minutes + geometry, or null. */
    const fetchOsrm = async (
        endpoint: string,
        from: [number, number],
        to: [number, number],
    ): Promise<{ minutes: number, route: [number, number][] } | null> => {
        const res = await fetch(`${endpoint}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`);
        if (!res.ok) throw new Error(`router ${res.status}`);
        const data = await res.json() as {
            routes?: { duration: number, geometry: { coordinates: [number, number][] } }[]
        };
        const route = data.routes?.[0];
        if (!route || route.geometry.coordinates.length < 2) return null;
        return {
            minutes: Math.max(1, Math.round(route.duration / 60)),
            route: route.geometry.coordinates,
        };
    };

    const fetchModeRoute = async (mode: TravelMode, hit: GeoHit): Promise<ModeResult> => {
        if (mode === 'walk' || mode === 'car') {
            const r = await fetchOsrm(mode === 'walk' ? OSRM_FOOT_ENDPOINT : OSRM_CAR_ENDPOINT, cfg.center, hit.lngLat);
            if (!r) return 'none';
            return {
                lngLat: hit.lngLat,
                walkMinutes: r.minutes,
                route: r.route,
                labelText: mode === 'walk' ? `${r.minutes} Min. zu Fuß` : `${r.minutes} Min. mit dem Auto`,
            };
        }

        // Transit: timetable itinerary between stops + OSRM first/last-mile walks.
        const url = `${TRANSIT_PLAN_ENDPOINT}?fromPlace=${cfg.center[1]},${cfg.center[0]}` +
            `&toPlace=${hit.lngLat[1]},${hit.lngLat[0]}` +
            `&radius=${TRANSIT_STOP_RADIUS_M}&time=${encodeURIComponent(transitDepartureIso())}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`transit ${res.status}`);
        const data = await res.json() as {
            itineraries?: {
                duration: number,
                legs: {
                    mode: string,
                    duration: number,
                    routeShortName?: string,
                    from?: { lat: number, lon: number },
                    to?: { lat: number, lon: number },
                    legGeometry?: { points?: string, precision?: number }
                }[]
            }[]
        };
        const itins = data.itineraries ?? [];
        if (itins.length === 0) return 'none';
        const best = itins.reduce((a, b) => (a.duration <= b.duration ? a : b));
        const legs = best.legs.filter(l => l.legGeometry?.points && l.from && l.to);
        if (legs.length === 0) return 'none';

        const firstStop: [number, number] = [legs[0].from!.lon, legs[0].from!.lat];
        const lastStop: [number, number] = [legs[legs.length - 1].to!.lon, legs[legs.length - 1].to!.lat];
        // First/last mile on foot (the `radius` trick starts the itinerary AT a
        // stop, so these walks must be added for honest door-to-door minutes).
        const [walkIn, walkOut] = await Promise.all([
            fetchOsrm(OSRM_FOOT_ENDPOINT, cfg.center, firstStop),
            fetchOsrm(OSRM_FOOT_ENDPOINT, lastStop, hit.lngLat),
        ]);

        const coords: [number, number][] = [];
        if (walkIn) coords.push(...walkIn.route);
        for (const leg of legs) {
            coords.push(...decodePolyline(leg.legGeometry!.points!, leg.legGeometry!.precision ?? 6));
        }
        if (walkOut) coords.push(...walkOut.route);
        if (coords.length < 2) return 'none';

        const minutes = Math.max(1, Math.round(best.duration / 60) + (walkIn?.minutes ?? 0) + (walkOut?.minutes ?? 0));
        const lines = legs
            .map(l => l.routeShortName)
            .filter((n): n is string => typeof n === 'string' && n.length > 0);
        const via = lines.length > 0 ? ` · ${[...new Set(lines)].join(' + ')}` : '';
        return {
            lngLat: hit.lngLat,
            walkMinutes: minutes,
            route: coords,
            labelText: `${minutes} Min.${via}`,
        };
    };

    const updateModePills = () => {
        modesRow.querySelectorAll('button').forEach((pill) => {
            const mode = pill.dataset.mode as TravelMode;
            const result = modeResults[mode];
            const mins = pill.querySelector('.surroundingsModeMins');
            if (mins) {
                mins.textContent = result === null ? '…' : result === 'none' ? '–' : `${result.walkMinutes} min`;
            }
            pill.classList.toggle('is-active', mode === activeMode);
            (pill as HTMLButtonElement).disabled = result === 'none';
        });
    };

    /** Fly to the route and draw it — shared by mode switches and fresh results. */
    const drawTarget = (target: RouteTarget) => {
        clearWalkLabel();
        setRoute([]);
        cancelAnimationFrame(drawFrame);
        map!.fitBounds(boundsOf([cfg.center, ...target.route, target.lngLat]), {
            padding: { top: 70, bottom: 90, left: 60, right: 60 },
            duration: 900,
            maxZoom: 16.5
        });
        const forHit = searchTarget;
        armRouteDraw(() => {
            if (customMarker && searchTarget === forHit) animateRoute(target);
        });
    };

    const loadMode = async (mode: TravelMode, hit: GeoHit) => {
        let result: ModeResult = 'none';
        try {
            result = await fetchModeRoute(mode, hit);
        } catch (err) {
            console.warn(`Surroundings ${mode} routing failed:`, err);
        }
        if (searchTarget !== hit) return;   // superseded by a newer search
        modeResults[mode] = result;
        updateModePills();
        if (mode === activeMode && result !== null && result !== 'none') {
            drawTarget(result);
        } else if (mode === activeMode && result === 'none' && mode === 'walk') {
            showMessage('Dorthin gibt es keine Fußroute.');
        }
    };

    const routeToAddress = (hit: GeoHit) => {
        if (!mapReady || !maplibre || !map) return;
        events.fire('analytics', 'surroundings', { action: 'search' });
        // Reset: a searched address replaces any active POI selection.
        activePoiId = null;
        clearWalkLabel();
        setRoute([]);
        cancelAnimationFrame(drawFrame);
        customMarker?.remove();
        const el = document.createElement('div');
        el.className = 'surroundingsDest';
        el.title = `${hit.label}, ${hit.detail}`;
        customMarker = new maplibre.Marker({ element: el }).setLngLat(hit.lngLat).addTo(map);

        searchTarget = hit;
        activeMode = 'walk';
        modeResults = { walk: null, car: null, transit: null };
        modesRow.classList.remove('hidden');
        updateModePills();
        // All three modes load in parallel; each fills its pill as it lands.
        void loadMode('walk', hit);
        void loadMode('car', hit);
        void loadMode('transit', hit);
    };

    modesRow.querySelectorAll('button').forEach((pill) => {
        pill.addEventListener('click', () => {
            const mode = pill.dataset.mode as TravelMode;
            if (mode === activeMode) return;
            activeMode = mode;
            updateModePills();
            const result = modeResults[mode];
            if (result !== null && result !== 'none') drawTarget(result);
        });
    });

    searchInput.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        const query = searchInput.value.trim();
        if (query.length < 3) {
            hideResults();
            return;
        }
        searchTimer = window.setTimeout((): void => {
            void geocode(query);
        }, 350);
    });

    // Enter takes the top suggestion — the muscle memory from every map app.
    searchInput.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' && hits.length > 0) {
            event.preventDefault();
            const first = hits[0];
            hideResults();
            searchInput.value = first.label;
            void routeToAddress(first);
        }
    });

    // -- concierge hooks ----------------------------------------------------------
    // Chat-triggered opens get a cinematic entrance: a slower, springier glass
    // reveal, and — when the map is already live — a camera pull-back over the
    // property so the following route flight reads as a dive-in sweep.
    let pendingPlace: GeoHit | null = null;

    const openCinematic = () => {
        if (!open) {
            overlay.classList.add('is-cinematic');
            // Force a style flush so the cinematic start pose is actually
            // rendered before .is-open lands — otherwise the transition would
            // run from the ordinary closed pose and the effect is lost.
            void overlay.offsetWidth;
            window.setTimeout(() => overlay.classList.remove('is-cinematic'), 900);
            if (mapReady && map) {
                // Instant (invisible: panel still faded out) reset to a wide
                // view over the property, so the upcoming fitBounds flies IN.
                map.jumpTo({ center: cfg.center, zoom: 12.2 });
            }
        }
        setOpen(true);
    };

    // The chat answered a "what's nearby" question: open the panel and play the
    // route. Fired by concierge.ts when the server names a mapPoi.
    events.on('surroundings:show', (poiId: string) => {
        openCinematic();
        selectPoi(poiId);
    });

    // The chat looked up a live place (find_place tool): open the panel and run
    // the same multi-mode routing as a manual address search.
    events.on('surroundings:showPlace', (place: { label: string, detail?: string, lngLat: [number, number] }) => {
        const hit: GeoHit = { label: place.label, detail: place.detail ?? '', lngLat: place.lngLat };
        openCinematic();
        if (!mapReady) {
            pendingPlace = hit;
            return;
        }
        searchInput.value = hit.label;
        routeToAddress(hit);
    });
};

export { initSurroundings };
