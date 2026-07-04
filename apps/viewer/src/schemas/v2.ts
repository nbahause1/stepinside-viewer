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
    soundUrl?: string,
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
        propertyId?: string
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
    // the default StepInside wordmark in the top-centre pill. `title` sets the
    // browser tab to "{title} — StepInside". `accentColor` overrides the viewer
    // accent (the --accent custom property). Absent or invalid values fall back
    // to stock StepInside branding — validation strips them instead of throwing.
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
// back to stock StepInside branding) instead of throwing like the assert*
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
