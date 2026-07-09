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

    return data as ExperienceSettings;
};

export { validateV2 };
export type { AnimTrack, Camera, Annotation, PostEffectSettings, ExperienceSettings };
