import {
    assertObject,
    assertNumber,
    assertString,
    assertBoolean,
    assertEnum,
    assertArray,
    assertNumberArray,
    assertTuple3
} from './validate-utils';

type AnimTrack = {
    name: string,
    duration: number,
    frameRate: number,
    loopMode: 'none' | 'repeat' | 'pingpong',
    interpolation: 'step' | 'spline',
    smoothness: number,
    keyframes: {
        times: number[],
        values: {
            position: number[],
            target: number[],
            fov: number[],
        }
    }
};

type CameraPose = {
    position: [number, number, number],
    target: [number, number, number],
    fov: number
};

type Camera = {
    initial: CameraPose,
};

type Annotation = {
    position: [number, number, number],
    title: string,
    text: string,
    extras?: any,
    camera: Camera;
};

type PostEffectSettings = {
    sharpness: {
        enabled: boolean,
        amount: number,
    },
    bloom: {
        enabled: boolean,
        intensity: number,
        blurLevel: number,
    },
    grading: {
        enabled: boolean,
        brightness: number,
        contrast: number,
        saturation: number,
        tint: [number, number, number],
    },
    vignette: {
        enabled: boolean,
        intensity: number,
        inner: number,
        outer: number,
        curvature: number,
    },
    fringing: {
        enabled: boolean,
        intensity: number
    }
};

type ExperienceSettings = {
    version: 2,
    tonemapping: 'none' | 'linear' | 'filmic' | 'hejl' | 'aces' | 'aces2' | 'neutral',
    highPrecisionRendering: boolean,
    // Legacy single entry sound (played once on the first user interaction).
    // Superseded by `sound` below; still honoured as the intro if `sound` is
    // absent.
    soundUrl?: string,

    // Entry sound effects (optional; cast-through like `concierge` — validateV2
    // only casts, so extra JSON keys pass through untouched). Subtle SFX played
    // on the first user interaction AFTER the scene is revealed (gesture-gated:
    // iOS/Safari block autoplay without a user gesture). `intro` plays first,
    // then `door` once the intro finishes — the "arrival + step inside" beat.
    // `volume` (0..1, default 0.6) keeps them discreet; `gap` (ms, default 0)
    // adds a pause between intro-end and door-start (negative overlaps them).
    // `footsteps` is a separate loop played while auto-walking to a clicked
    // point (starts on navTarget:set, stops on navTarget:clear); `footstepsVolume`
    // (0..1, default 0.5) sets its level.
    // `measureStart` plays when the first measurement point is placed and
    // `measureEnd` when the second finalises it; `measureVolume` (default 0.4).
    // `droneAmbient` is a hum looped while in aerial (drone) mode (starts on
    // entering, stops on leaving); `droneSwitch` is a take-off one-shot on each
    // aerial view change. `droneAmbientVolume`/`droneSwitchVolume` default 0.5.
    sound?: {
        intro?: string,
        door?: string,
        volume?: number,
        gap?: number,
        footsteps?: string,
        footstepsVolume?: number,
        measureStart?: string,
        measureEnd?: string,
        measureVolume?: number,
        droneAmbient?: string,
        droneSwitch?: string,
        droneAmbientVolume?: number,
        droneSwitchVolume?: number,
        // `stagingReveal` plays when the furnished ("Möbliert") room is revealed
        // after the loader; `stagingRevealVolume` (default 0.4).
        stagingReveal?: string,
        stagingRevealVolume?: number
    },
    background: {
        color: [number, number, number],
        skyboxUrl?: string
    },
    postEffectSettings: PostEffectSettings,

    animTracks: AnimTrack[],
    cameras: Camera[],
    annotations: Annotation[],

    // 'hidden' keeps tooltips + the ‹ › navigator fully functional but never
    // renders the in-scene number bubbles. 'overview' shows the bubbles ONLY
    // in the bird's-eye view and during the guided tour — the walking view
    // stays clean. Absent/'visible' = today's look.
    annotationMarkers?: 'visible' | 'hidden' | 'overview',

    // Curated bird's-eye ("Drohnen") viewpoints, PER PROPERTY. Cast-through
    // like analytics/survey: absent = a bbox-derived fallback tuned for the
    // demo scan. Authoring these is part of onboarding every new property
    // (the staging capture uses view 0 as its fixed frame).
    aerialViews?: {
        position: number[],
        target: number[],
        fov?: number
    }[],

    // Guided-tour ("Rundgang") pacing, relative to the authored track time.
    // `speed` is the normal playback rate (default 1.5 — the authored tracks
    // are deliberately slow), `revealSpeed` the slow-motion rate while a
    // fly-by annotation bubble is being read (default 0.35).
    tour?: {
        speed?: number,
        revealSpeed?: number
    },

    startMode: 'default' | 'animTrack' | 'annotation',

    // Concierge config (optional; ignored by validateV2 which only casts, so
    // extra JSON keys pass through untouched). Two modes:
    //   'ai' (default): POSTs to a server-side Claude endpoint (needs endpoint +
    //         propertyId). Non-secret: the API key lives server-side.
    //   'scripted': no backend at all. The panel shows the `greeting`, then one
    //         tappable suggestion button per POI that has a question/answer; the
    //         answer is fixed and the camera jumps to that POI.
    concierge?: {
        mode?: 'ai' | 'scripted',
        greeting?: string,
        endpoint?: string,
        propertyId?: string,
        // AI mode: after this many sent questions the chat offers the broker
        // contact card (soft UX nudge; the server enforces the hard cost caps
        // separately). Default 8.
        softLimit?: number,
        // Broker/host contact shown by the soft-limit card and when the daily
        // question cap is reached. Display data only, no secrets.
        contact?: {
            name?: string,
            phone?: string,
            email?: string,
            // Booking/appointment URL ("Termin vereinbaren").
            url?: string,
            // Listing PDF/page URL ("Exposé ansehen"); relative to the viewer or absolute.
            exposeUrl?: string
        }
    },

    // Curated points of interest the concierge can jump the camera to (e.g. the
    // window, a door). Authored once per scan; `camera` is captured via the
    // console helper captureView(). In AI mode the browser sends only
    // {id,label,keywords} to the model; in scripted mode `question`/`answer`
    // drive a fixed suggestion button. The camera pose stays client-side.
    pois?: {
        id: string,
        label: string,
        keywords?: string[],
        question?: string,
        answer?: string,
        camera: {
            position: [number, number, number],
            target: [number, number, number],
            fov: number
        }
    }[],

    // AI virtual-staging config (optional; cast-through like `concierge`). When
    // `enabled` and an `endpoint` are set, the viewer shows a "Möbliert sehen"
    // pill that renders the current frame, POSTs it to the staging endpoint and
    // lays the furnished image over the live scan. The GEMINI key lives
    // server-side; the browser only sends { propertyId, image, style }.
    staging?: {
        enabled?: boolean,
        // 'live' (default): each click renders the frame + POSTs it to `endpoint`
        //   (real model call, costs per image). 'demo': no API call — the loader
        //   plays, then a pre-generated image bundled per style is shown. Used on
        //   the public showcase so visitors can't run up model costs.
        mode?: 'live' | 'demo',
        endpoint?: string,
        propertyId?: string,
        // Optional style picker shown in the overlay. Each id must match a style
        // the server knows (warm | scandi | classic | modern). In 'demo' mode each
        // style carries `image` (landscape, used on desktop) and optionally
        // `imagePortrait` (9:16, used on narrow/portrait screens) — pre-generated
        // pictures (URLs relative to the viewer) shown instead of a live result.
        // Omit styles for a single default style.
        styles?: { id: string, label: string, image?: string, imagePortrait?: string }[]
    },

    // Per-scan white-label branding (optional). Lets a customer's tour carry
    // their own mark: `logoUrl` (image) beats `logoText` (wordmark text) beats
    // the default innsyn wordmark in the top-centre pill. `title` sets the
    // browser tab to "{title} — innsyn". `accentColor` overrides the viewer
    // accent (the --accent custom property). Absent or invalid values fall back
    // to stock innsyn branding — validation strips them instead of throwing.
    branding?: {
        title?: string,
        logoText?: string,
        logoUrl?: string,
        accentColor?: string
    },

    // In-viewer lead capture (optional; cast-through like `concierge`). When
    // `email` or `url` is set the viewer shows a discreet glass CTA pill
    // (top-right). Tapping it opens `url` in a new tab, or — url absent — a
    // pre-addressed mailto to `email` with `subject` (default
    // "Anfrage: {branding.title or document.title}"). `label` defaults to
    // "Besichtigung anfragen". With neither target set the pill stays hidden.
    inquiry?: {
        label?: string,
        email?: string,
        url?: string,
        subject?: string
    },

    // Anonymous usage analytics (optional; cast-through like `inquiry`). With
    // both `endpoint` and `propertyId` set, the viewer batches anonymous
    // interaction events (opens, dwell heartbeats, feature usage) to the
    // endpoint for the owner's report. Absent or incomplete, the whole module
    // is an inert no-op. Privacy by design: no cookies, no localStorage, no
    // fingerprinting — the session id is crypto-random and in-memory only, so
    // two visits by the same person are two unrelated sessions.
    analytics?: {
        endpoint?: string,
        propertyId?: string
    },

    // Engagement survey + lead CTA card (optional; cast-through like
    // `analytics`, on which it rides). With analytics configured the card is
    // ON by default — `enabled: false` switches it off. After genuine
    // engagement (tour complete / `afterSeconds` of visible time, default
    // 40 s / a long fullscreen stint) it asks one 1-5 question and, on a
    // positive answer, offers "Besichtigung anfragen" / "Exposé erhalten"
    // CTAs with a mini lead form.
    // `leadEndpoint` overrides where the form POSTs; it defaults to the
    // analytics endpoint with /events swapped for /lead. Privacy: the only
    // thing persisted is a one-word "already asked" flag per property
    // (localStorage `sse:survey:{propertyId}`) so nobody is asked twice — no
    // identifiers, nothing linking sessions or properties.
    survey?: {
        enabled?: boolean,
        leadEndpoint?: string,
        afterSeconds?: number
    },

    // Neighbourhood map (optional; cast-through like `concierge`). With a
    // `center` and at least one POI the viewer shows an "Umgebung" pill that
    // opens a map overlay (MapLibre GL, lazy-loaded on first open): house
    // marker, one chip per POI, and an animated walking route house→POI with
    // minutes. Data is precomputed once per property by
    // scripts/fetch-surroundings.mjs (Overpass + OSRM) — the browser never
    // calls a geo service, only the tile server behind `styleUrl`.
    // LICENSING: the default style is CARTO (free for non-commercial use
    // only) — set `styleUrl` to a licensed provider (MapTiler/Stadia) before
    // a commercial go-live.
    surroundings?: {
        // [lng, lat] of the property.
        center: [number, number],
        // MapLibre style URL override (tile provider).
        styleUrl?: string,
        pois: {
            id: string,             // stable id, referenced by the concierge's mapPoi
            label: string,          // category label on the chip ("Supermarkt")
            name: string,           // real place name ("EDEKA Schlemmermarkt Struve")
            lngLat: [number, number],
            walkMinutes: number,
            walkMeters?: number,
            // Walking route geometry house→POI, [lng, lat] pairs (GeoJSON order).
            route: [number, number][]
        }[]
    },

    // Authored room dimensions ("Raummaße", optional; cast-through like
    // `surroundings`). In the bird's-eye view every room shows its dimension
    // lines (solid hairlines along the wall bases, corner-to-corner, with
    // metric labels) — the Matterport "show dimensions" idea, but curated:
    // the numbers are read once from the calibrated scan at authoring time
    // (console helpers `probeRoom()` / `roomEntry()` in measure.ts) and
    // stored here, so nothing is guessed live and the lines always sit
    // exactly on the walls. Walk mode stays clean — down there the ruler is
    // the visitor's own two-point measurement. Rendered by room-dimensions.ts.
    rooms?: {
        name: string,
        // Room anchor (reserved for multi-floor filtering; the bird's-eye
        // view currently shows every authored room).
        center: [number, number, number],
        // Dimension lines; each is drawn with the metric length of a→b as
        // its label (lengths are recomputed from the points, never stored).
        // roomEntry() emits a closed floor perimeter (shared corner points)
        // plus one ceiling-height line in the far corner.
        lines: {
            a: [number, number, number],
            b: [number, number, number]
        }[],
        // Optional floor area in m² (not currently rendered).
        area?: number
    }[],

    // Optional scale verification (cast-through like `staging`). Authored once per
    // scan: pick a feature of KNOWN real length in the viewer (with config.debug on
    // the measure tool logs the two endpoints + length, ready to paste here), then
    // set `meters` to that feature's true real-world length. On load the viewer
    // recomputes the distance between `points` and compares it to `meters`; a
    // deviation beyond `tolerance` (default 0.02 = 2%) means the splat is NOT at
    // true metric scale, so every measurement and floor-plan dimension would be
    // wrong. Verification only: it warns, it does not rescale (scale is baked at
    // export). See `calibration.ts`.
    calibration?: {
        points: [[number, number, number], [number, number, number]],
        meters: number,
        tolerance?: number
    }
};

const TONEMAPPING = ['none', 'linear', 'filmic', 'hejl', 'aces', 'aces2', 'neutral'] as const;
const LOOP_MODES = ['none', 'repeat', 'pingpong'] as const;
const INTERPOLATIONS = ['step', 'spline'] as const;
const START_MODES = ['default', 'animTrack', 'annotation'] as const;

const validateAnimTrack = (data: unknown, path: string): AnimTrack => {
    const obj = assertObject(data, path);
    assertString(obj.name, `${path}.name`);
    assertNumber(obj.duration, `${path}.duration`);
    assertNumber(obj.frameRate, `${path}.frameRate`);
    assertEnum(obj.loopMode, LOOP_MODES, `${path}.loopMode`);
    assertEnum(obj.interpolation, INTERPOLATIONS, `${path}.interpolation`);
    assertNumber(obj.smoothness, `${path}.smoothness`);

    const kf = assertObject(obj.keyframes, `${path}.keyframes`);
    assertNumberArray(kf.times, `${path}.keyframes.times`);
    const vals = assertObject(kf.values, `${path}.keyframes.values`);
    assertNumberArray(vals.position, `${path}.keyframes.values.position`);
    assertNumberArray(vals.target, `${path}.keyframes.values.target`);
    assertNumberArray(vals.fov, `${path}.keyframes.values.fov`);

    return data as AnimTrack;
};

const validateCamera = (data: unknown, path: string): Camera => {
    const obj = assertObject(data, path);
    const initial = assertObject(obj.initial, `${path}.initial`);
    assertTuple3(initial.position, `${path}.initial.position`);
    assertTuple3(initial.target, `${path}.initial.target`);
    assertNumber(initial.fov, `${path}.initial.fov`);
    return data as Camera;
};

const validateAnnotation = (data: unknown, path: string): Annotation => {
    const obj = assertObject(data, path);
    assertTuple3(obj.position, `${path}.position`);
    assertString(obj.title, `${path}.title`);
    assertString(obj.text, `${path}.text`);
    validateCamera(obj.camera, `${path}.camera`);
    return data as Annotation;
};

const validatePostEffects = (data: unknown, path: string): PostEffectSettings => {
    const obj = assertObject(data, path);

    const sh = assertObject(obj.sharpness, `${path}.sharpness`);
    assertBoolean(sh.enabled, `${path}.sharpness.enabled`);
    assertNumber(sh.amount, `${path}.sharpness.amount`);

    const bl = assertObject(obj.bloom, `${path}.bloom`);
    assertBoolean(bl.enabled, `${path}.bloom.enabled`);
    assertNumber(bl.intensity, `${path}.bloom.intensity`);
    assertNumber(bl.blurLevel, `${path}.bloom.blurLevel`);

    const gr = assertObject(obj.grading, `${path}.grading`);
    assertBoolean(gr.enabled, `${path}.grading.enabled`);
    assertNumber(gr.brightness, `${path}.grading.brightness`);
    assertNumber(gr.contrast, `${path}.grading.contrast`);
    assertNumber(gr.saturation, `${path}.grading.saturation`);
    assertTuple3(gr.tint, `${path}.grading.tint`);

    const vi = assertObject(obj.vignette, `${path}.vignette`);
    assertBoolean(vi.enabled, `${path}.vignette.enabled`);
    assertNumber(vi.intensity, `${path}.vignette.intensity`);
    assertNumber(vi.inner, `${path}.vignette.inner`);
    assertNumber(vi.outer, `${path}.vignette.outer`);
    assertNumber(vi.curvature, `${path}.vignette.curvature`);

    const fr = assertObject(obj.fringing, `${path}.fringing`);
    assertBoolean(fr.enabled, `${path}.fringing.enabled`);
    assertNumber(fr.intensity, `${path}.fringing.intensity`);

    return data as PostEffectSettings;
};

const BRANDING_KEYS = ['title', 'logoText', 'logoUrl', 'accentColor'] as const;

// Branding is optional cosmetics: a malformed object or wrong-typed field must
// never reject the whole settings file, so invalid values are stripped (falling
// back to stock innsyn branding) instead of throwing like the assert*
// helpers do.
const sanitizeBranding = (obj: Record<string, unknown>) => {
    const raw = obj.branding;
    if (raw === undefined) return;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        delete obj.branding;
        return;
    }
    const branding = raw as Record<string, unknown>;
    BRANDING_KEYS.forEach((key) => {
        const value = branding[key];
        if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
            delete branding[key];
        }
    });
};

const validateV2 = (data: unknown): ExperienceSettings => {
    const obj = assertObject(data, 'settings');

    if (obj.version !== 2) {
        throw new Error('settings.version must be 2');
    }

    assertEnum(obj.tonemapping, TONEMAPPING, 'settings.tonemapping');
    assertBoolean(obj.highPrecisionRendering, 'settings.highPrecisionRendering');
    if (obj.soundUrl !== undefined) assertString(obj.soundUrl, 'settings.soundUrl');

    const bg = assertObject(obj.background, 'settings.background');
    assertTuple3(bg.color, 'settings.background.color');
    if (bg.skyboxUrl !== undefined) assertString(bg.skyboxUrl, 'settings.background.skyboxUrl');

    validatePostEffects(obj.postEffectSettings, 'settings.postEffectSettings');

    const tracks = assertArray(obj.animTracks, 'settings.animTracks');
    tracks.forEach((t: unknown, i: number) => validateAnimTrack(t, `settings.animTracks[${i}]`));

    const cameras = assertArray(obj.cameras, 'settings.cameras');
    cameras.forEach((c: unknown, i: number) => validateCamera(c, `settings.cameras[${i}]`));

    const annotations = assertArray(obj.annotations, 'settings.annotations');
    annotations.forEach((a: unknown, i: number) => validateAnnotation(a, `settings.annotations[${i}]`));

    assertEnum(obj.startMode, START_MODES, 'settings.startMode');

    sanitizeBranding(obj);

    return data as ExperienceSettings;
};

export { validateV2 };
export type { AnimTrack, Camera, Annotation, PostEffectSettings, ExperienceSettings };
