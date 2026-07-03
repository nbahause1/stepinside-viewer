import {
    Asset,
    Color,
    createGraphicsDevice,
    Entity,
    EventHandler,
    Keyboard,
    Mouse,
    platform,
    TouchDevice,
    type Texture,
    type TextureHandler,
    type AppBase,
    revision as engineRevision,
    version as engineVersion
} from 'playcanvas';

import { initAnalytics } from './analytics';
import { App } from './app';
import { initBranding } from './branding';
import { MeshCollision, loadVoxelCollision } from './collision';
import type { Collision } from './collision';
import { observe } from './core/observe';
import { initLocalization } from './localization';
import { importSettings } from './settings';
import type { Config, Global } from './types';
import { initControls } from './controls';
import { initConcierge } from './concierge';
import { initInquiry } from './inquiry';
import { initShare } from './share';
import { initStaging } from './staging';
import { initSurvey } from './survey';
import { initTutorial } from './tutorial';
import { initPoster, initUI } from './ui';
import { Viewer } from './viewer';
import { initXr } from './xr';
import { version as appVersion } from '../package.json';

const loadGsplat = async (app: AppBase, config: Config, progressCallback: (progress: number) => void) => {
    const { contents, contentUrl } = config;
    const c = contents as unknown as ArrayBuffer;
    const filename = new URL(contentUrl, location.href).pathname.split('/').pop();
    // Parse the JSON manifest for both single-file SOG (`meta.json`) and the
    // streamed multi-LOD format (`lod-meta.json`); the gsplat loader streams the
    // referenced chunks progressively for the LOD case.
    const data = filename.toLowerCase().endsWith('meta.json') ? await (await contents).json() : undefined;
    const asset = new Asset(filename, 'gsplat', { url: contentUrl, filename, contents: c }, data);

    return new Promise<Entity>((resolve, reject) => {
        asset.on('load', () => {
            const entity = new Entity('gsplat');
            entity.setLocalEulerAngles(0, 0, 180);
            entity.addComponent('gsplat', {
                unified: true,
                asset
            });
            app.root.addChild(entity);
            resolve(entity);
        });

        let watermark = 0;
        asset.on('progress', (received, length) => {
            const progress = Math.min(1, received / length) * 100;
            if (progress > watermark) {
                watermark = progress;
                progressCallback(Math.trunc(watermark));
            }
        });

        asset.on('error', (err) => {
            if (config.devtools) {
                console.error(err);
            }
            reject(err);
        });

        app.assets.add(asset);
        app.assets.load(asset);
    });
};

const loadSkybox = (app: AppBase, url: string) => {
    return new Promise<Asset>((resolve, reject) => {
        const asset = new Asset('skybox', 'texture', {
            url
        }, {
            type: 'rgbp',
            mipmaps: false,
            addressu: 'repeat',
            addressv: 'clamp'
        });

        asset.on('load', () => {
            resolve(asset);
        });

        asset.on('error', (err) => {
            // the caller logs a warning; avoid dumping the raw error for visitors
            reject(err);
        });

        app.assets.add(asset);
        app.assets.load(asset);
    });
};

const createApp = async (canvas: HTMLCanvasElement, config: Config) => {
    const useWebGPU = config.renderer === 'webgpu';

    // Create the graphics device. List the fallbacks explicitly: try WebGPU
    // first (best splat performance) but fall through to WebGL2/WebGL when it is
    // unavailable (e.g. Safari without WebGPU) instead of failing to a black
    // scene. xrCompatible keeps the WebGL fallback usable for AR/VR.
    const device = await createGraphicsDevice(canvas, {
        deviceTypes: useWebGPU ? ['webgpu', 'webgl2', 'webgl'] : ['webgl2', 'webgl'],
        antialias: false,
        depth: true,
        stencil: false,
        xrCompatible: true,
        powerPreference: 'high-performance'
    });

    if (config.devtools) {
        console.log(`Renderer: ${device.deviceType}`);
    }

    // The engine may have fallen back from WebGPU to WebGL2; downstream code
    // (voxel overlay, XR, gsplat renderer selection) needs the *actual* renderer.
    const renderer: 'webgl' | 'webgpu' = device.deviceType === 'webgpu' ? 'webgpu' : 'webgl';

    // Set maxPixelRatio so the XR framebuffer scale factor is computed correctly.
    // Regular rendering bypasses maxPixelRatio via the custom initCanvas sizing.
    device.maxPixelRatio = window.devicePixelRatio;

    // Create the application
    const app = new App(canvas, {
        graphicsDevice: device,
        mouse: new Mouse(canvas),
        touch: new TouchDevice(canvas),
        keyboard: new Keyboard(window)
    });

    // enable anonymous CORS for image loading in safari (must be set before any
    // texture asset starts loading, otherwise the <img> is fetched without the
    // crossorigin attribute and WebGL rejects it with SecurityError)
    (app.loader.getHandler('texture') as TextureHandler).imgParser.crossOrigin = 'anonymous';

    // Create entity hierarchy
    const cameraRoot = new Entity('camera root');
    app.root.addChild(cameraRoot);

    const camera = new Entity('camera');
    cameraRoot.addChild(camera);

    const light = new Entity('light');
    light.setEulerAngles(35, 45, 0);
    light.addComponent('light', {
        color: new Color(1.0, 0.98, 0.957),
        intensity: 1
    });
    app.root.addChild(light);

    app.scene.ambientLight.set(0.51, 0.55, 0.65);

    return { app, camera, renderer };
};

// initialize canvas size and resizing
const initCanvas = (global: Global) => {
    const { app, events, state } = global;
    const { canvas } = app.graphicsDevice;

    // maximum pixel dimension we will allow along the shortest screen dimension.
    // WebGL (Safari) can't GPU-sort splats and is fill-rate bound on Retina, so
    // cap the render resolution much harder there to keep it smooth. WebGPU
    // (Chrome/Android) GPU-sorts and stays sharp, but full Retina (2160) is
    // fill-rate bound enough to drop frames — and splats are soft blobs with no
    // crisp detail to resolve, so a modest 1536 cap restores 60fps at nearly
    // invisible quality cost.
    // Mobile WebGL (iOS Safari) stays at 768: bumping to 1080 dropped frames on
    // real iPhones (WebGL CPU-sorts splats and is fill-rate bound on Retina). We
    // address the resulting softness with a sharpening post-pass instead (see
    // settings.json), which costs no extra render resolution.
    const webgl = global.renderer === 'webgl';
    const maxPixelDim = platform.mobile ? (webgl ? 768 : 1080) : (webgl ? 1080 : 1536);

    // cap pixel ratio to limit resolution on high-DPI devices
    const calcPixelRatio = () => Math.min(maxPixelDim / Math.min(screen.width, screen.height), window.devicePixelRatio);

    // last known device pixel size (full resolution, before any quality scaling)
    const deviceSize = { width: 0, height: 0 };

    const set = (width: number, height: number) => {
        const ratio = calcPixelRatio();
        deviceSize.width = width * ratio;
        deviceSize.height = height * ratio;
    };

    const apply = () => {
        // don't resize the canvas during XR - the XR system manages its own framebuffers
        // and resetting canvas dimensions can invalidate the XRWebGLLayer
        if (app.xr?.active) return;

        // Resolution scale. On mobile we use *dynamic resolution*: render at half
        // scale while the camera is moving (keeps motion smooth on the fill-rate-
        // bound WebGL path) and at full scale once it settles (a sharp still
        // image). This is independent of performanceMode, which controls the splat
        // budget — so smoothness while moving is preserved. Desktop keeps the
        // static performanceMode scale.
        const s = platform.mobile
            ? (global.cameraMoving ? 0.5 : 1.0)
            : (state.performanceMode ? 0.5 : 1.0);
        const w = Math.ceil(deviceSize.width * s);
        const h = Math.ceil(deviceSize.height * s);
        if (w !== canvas.width || h !== canvas.height) {
            canvas.width = w;
            canvas.height = h;
        }
    };

    const resizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
        const e = entries[0]?.contentBoxSize?.[0];
        if (e) {
            set(e.inlineSize, e.blockSize);
            app.renderNextFrame = true;
        }
    });
    resizeObserver.observe(canvas);

    events.on('performanceMode:changed', () => {
        app.renderNextFrame = true;
    });

    // Resize canvas before render() so the swap chain texture is acquired at the correct size.
    app.on('framerender', apply);

    // Disable the engine's built-in canvas resize — we handle it via ResizeObserver
    // @ts-ignore
    app._allowResize = false;
    set(canvas.clientWidth, canvas.clientHeight);
    apply();
};

const main = async (canvas: HTMLCanvasElement, settingsJson: any, config: Config) => {
    const { app, camera, renderer } = await createApp(canvas, config);

    // create events
    const events = new EventHandler();

    // migrate legacy `retinaDisplay` preference (inverted) to `performanceMode`
    const legacyRetina = localStorage.getItem('retinaDisplay');
    if (legacyRetina !== null && localStorage.getItem('performanceMode') === null) {
        localStorage.setItem('performanceMode', String(legacyRetina === 'false'));
        localStorage.removeItem('retinaDisplay');
    }
    const storedPerformanceMode = localStorage.getItem('performanceMode');

    const state = observe(events, {
        loaded: false,
        readyToRender: false,
        performanceMode: storedPerformanceMode !== null ? storedPerformanceMode === 'true' : platform.mobile,
        progress: 0,
        inputMode: platform.mobile ? 'touch' : 'desktop',
        cameraMode: 'orbit',
        hasAnimation: false,
        animationDuration: 0,
        animationTime: 0,
        animationPaused: true,
        hasAR: false,
        hasVR: false,
        hasCollision: false,
        hasCollisionOverlay: false,
        walkAllowed: false,
        collisionOverlayEnabled: false,
        isFullscreen: false,
        controlsHidden: false,
        gamingControls: localStorage.getItem('gamingControls') === 'true',
        moveLocked: false,
        chatOpen: false,
        prewarming: false
    });

    const global: Global = {
        app,
        settings: importSettings(settingsJson),
        config,
        state,
        events,
        camera,
        renderer,
        cameraMoving: false
    };

    initCanvas(global);

    // DEV: expose globals for camera tuning — only for the authoring/tooling
    // entry points (?debug / ?scout / ?record), never in the visitor path
    if (config.devtools) {
        (window as any).viewer = global;
    }

    // start the application
    app.start();

    // Initialize the load-time poster
    if (config.poster) {
        initPoster(events);
    }

    camera.addComponent('camera');

    // Initialize XR support (availability detection always runs so the UI can offer
    // a reload into WebGL when the user requests AR/VR under WebGPU)
    initXr(global);

    // Initialize user interface
    initLocalization();
    initUI(global);
    initBranding(global);
    // share/deep-link before tutorial: on 'loaded'/'prewarming' a deep-linked
    // pose must be applied before the onboarding samples its starting yaw
    initShare(global);
    initTutorial(global);
    initControls(global);
    initConcierge(global);
    initStaging(global);
    initInquiry(global);
    // anonymous usage analytics (inert no-op without settings.analytics); must
    // init before the Viewer so its 'inputEvent' listener registers ahead of
    // the camera manager's (it reads the pre-transition camera mode)
    initAnalytics(global);
    // engagement survey + lead CTA card (rides on analytics; inert without it)
    initSurvey(global);

    // Load model
    const gsplatLoad = loadGsplat(
        app,
        config,
        (progress: number) => {
            state.progress = progress;
        }
    );

    // Load skybox (continue without if it fails — e.g. CORS, 404)
    const skyboxLoad = config.skyboxUrl &&
        loadSkybox(app, config.skyboxUrl).then((asset) => {
            app.scene.envAtlas = asset.resource as Texture;
        }).catch((err: Error) => {
            console.warn('Failed to load skybox:', err);
        });

    // Load collision data (type determined by file extension)
    let collisionLoad: Promise<Collision> | undefined;
    if (config.collisionUrl) {
        const ext = new URL(config.collisionUrl, location.href).pathname.split('.').pop()?.toLowerCase();
        if (ext === 'glb') {
            collisionLoad = MeshCollision.fromGlb(app, config.collisionUrl).catch((err: Error): null => {
                console.warn('Failed to load mesh collision:', err);
                return null;
            });
        } else {
            collisionLoad = loadVoxelCollision(config.collisionUrl).catch((err: Error): null => {
                console.warn('Failed to load voxel data:', err);
                return null;
            });
        }
    }

    // Load and play sound
    if (global.settings.soundUrl) {
        const sound = new Audio(global.settings.soundUrl);
        sound.crossOrigin = 'anonymous';
        document.body.addEventListener('click', () => {
            if (sound) {
                sound.play();
            }
        }, {
            capture: true,
            once: true
        });
    }

    // Create the viewer
    return new Viewer(global, gsplatLoad, skyboxLoad, collisionLoad);
};

console.log(`StepInside Viewer v${appVersion} | Engine v${engineVersion} (${engineRevision})`);

export { main };
