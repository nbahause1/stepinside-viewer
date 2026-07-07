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
import { getZoom, registerZoomNotifier, resetZoom } from './cameras/zoom';
import type { Collision } from './collision';
import { MeshCollision, loadVoxelCollision } from './collision';
import { initConcierge } from './concierge';
import { initControls } from './controls';
import { observe } from './core/observe';
import { initInquiry } from './inquiry';
import { initLocalization } from './localization';
import { importSettings } from './settings';
import { initShare } from './share';
import { initStaging } from './staging';
import { initSurvey } from './survey';
import { initTutorial } from './tutorial';
import type { Config, Global } from './types';
import { initPoster, initUI } from './ui';
import { Viewer } from './viewer';
import { initZoomIndicator } from './zoom-indicator';
import { version as appVersion } from '../package.json';

// iPadOS reports a desktop UA, so PlayCanvas' platform.mobile is FALSE on an
// iPad — which would otherwise give it desktop resolution, desktop (mouse)
// input, and the desktop LOD falloff. The entry point flags it via
// config.mobile (a maxTouchPoints probe). Use this everywhere a touch /
// constrained-device decision is made so an iPad behaves like the tablet it is.
const isMobile = (config: Config) => config.mobile ?? platform.mobile;

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
            if (isMobile(config) && entity.gsplat) {
                // Indoor LOD distances: the engine default (5 m base, 3x per
                // level) keeps the NEIGHBOURING room at full detail. In a flat
                // the next room starts 2-3 m away — drop it a level sooner.
                // High-tier phones get a milder falloff (quality first),
                // mid/low the tight one. Mobile only; desktop untouched.
                const high = config.tier === 'high';
                entity.gsplat.lodBaseDistance = high ? 3.5 : 2.5;
                entity.gsplat.lodMultiplier = high ? 3 : 2.5;
            }
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
    const { app, events, state, config } = global;
    const { canvas } = app.graphicsDevice;
    // Effective touch/constrained flag (iPad-aware; see isMobile).
    const mobile = isMobile(config);

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
    // Resolution cap per device tier (fill rate is THE mobile bottleneck —
    // TBDR GPUs blend every overlapping splat fragment):
    //   high phones keep near-native 1080 (they proved they can, and quality
    //   is the product), mid drops to 900, low (12-mini class) to 560 —
    //   heat is cumulative, weak devices must run cool from second one.
    // Reads state.deviceTier so a runtime DEMOTION resizes too.
    const maxPixelDim = () => {
        // Hero still: once the camera has settled, a desktop renders the static
        // frame near-native (it's cheap when nothing moves and this is exactly
        // when detail is judged). Mobile keeps its tier cap — there the detail
        // win comes from finer LOD + budget (see viewer.ts), not resolution,
        // to stay within fill-rate/memory limits.
        if (state.heroStill && !mobile) return webgl ? 1536 : 2048;
        if (!mobile) {
            // Desktop is tier-aware too now: a runtime DEMOTION on a weak /
            // throttled Mac drops the resolution cap alongside the splat
            // budget (high = near-native, mid/low progressively lighter).
            if (webgl) return state.deviceTier === 'low' ? 900 : 1080;
            return state.deviceTier === 'low' ? 1080 : (state.deviceTier === 'mid' ? 1280 : 1536);
        }
        if (webgl) return state.deviceTier === 'low' ? 560 : 768;
        return state.deviceTier === 'low' ? 560 : (state.deviceTier === 'mid' ? 900 : 1080);
    };

    // Optical-zoom sharpness: while zoomed in, raise the cap in step with the
    // zoom factor (quantized to half steps so the swap chain doesn't
    // reallocate on every pinch frame). devicePixelRatio stays the hard
    // ceiling, so this converges on the display's NATIVE resolution — the
    // zoomed-in view is exactly where the capped soft splat rendering would
    // otherwise read as blur.
    const zoomBoost = () => 1 + Math.min(1.5, Math.round((getZoom() - 1) * 2) / 2);

    // cap pixel ratio to limit resolution on high-DPI devices
    const calcPixelRatio = () => Math.min((maxPixelDim() * zoomBoost()) / Math.min(screen.width, screen.height), window.devicePixelRatio);

    // last known client size + device pixel size (before any quality scaling)
    const clientSize = { width: 0, height: 0 };
    const deviceSize = { width: 0, height: 0 };

    const set = (width: number, height: number) => {
        clientSize.width = width;
        clientSize.height = height;
        const ratio = calcPixelRatio();
        deviceSize.width = width * ratio;
        deviceSize.height = height * ratio;
    };

    const apply = () => {
        // don't resize the canvas during XR - the XR system manages its own framebuffers
        // and resetting canvas dimensions can invalidate the XRWebGLLayer
        if (app.xr?.active) return;

        // Resolution scale. On mobile we use *dynamic resolution*: render at
        // reduced scale while the camera is moving (keeps motion smooth on the
        // fill-rate-bound path) and full scale once it settles (a sharp still).
        // Nuance for "looking around on the spot": rotating in place is exactly
        // where a viewer studies a room, and the harsh 0.5x reads as blurry —
        // so when the POSITION is stable (rotation only, no walking) capable
        // phones render at a higher moving scale. Walking through space keeps
        // the hard 0.5x (streaming + fill), and the low tier always stays 0.5x
        // to protect smoothness. Desktop keeps the static performanceMode scale.
        const movingScale = state.positionStable ?
            (state.deviceTier === 'high' ? 0.85 : (state.deviceTier === 'mid' ? 0.7 : 0.5)) :
            0.5;
        const s = mobile ?
            (global.cameraMoving ? movingScale : 1.0) :
            (state.performanceMode ? 0.5 : 1.0);
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

    // re-derive the resolution cap when the optical zoom changes
    events.on('zoom:changed', () => {
        set(clientSize.width, clientSize.height);
        app.renderNextFrame = true;
    });

    // ...and when the runtime demotes the device tier
    events.on('deviceTier:changed', () => {
        set(clientSize.width, clientSize.height);
        app.renderNextFrame = true;
    });

    // ...and when the hero-still state flips (desktop resolution boost on settle)
    events.on('heroStill:changed', () => {
        set(clientSize.width, clientSize.height);
        app.renderNextFrame = true;
    });

    // ...and when position-stability flips (mobile rotate-in-place gets a higher
    // moving scale; apply() reads it live, this just forces the re-render).
    events.on('positionStable:changed', () => {
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
    const d = (window as any).__diag as ((m: string) => void) | undefined;
    d?.(`main: creating app + graphics device (${config.renderer})…`);
    const { app, camera, renderer } = await createApp(canvas, config);
    d?.(`main: device ready (${renderer})`);

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
        performanceMode: storedPerformanceMode !== null ? storedPerformanceMode === 'true' : isMobile(config),
        progress: 0,
        inputMode: isMobile(config) ? 'touch' : 'desktop',
        cameraMode: 'orbit',
        hasAnimation: false,
        animationDuration: 0,
        animationTime: 0,
        animationPaused: true,
        hasCollision: false,
        hasCollisionOverlay: false,
        walkAllowed: false,
        collisionOverlayEnabled: false,
        isFullscreen: false,
        controlsHidden: false,
        gamingControls: localStorage.getItem('gamingControls') === 'true',
        moveLocked: false,
        chatOpen: false,
        prewarming: false,
        tourRevealActive: false,
        deviceTier: config.tier ?? 'high',
        heroStill: false,
        positionStable: false
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

    // optical zoom (walk/fly): forward target changes onto the event bus for
    // the resolution cap + badge, and ease back to 1× on every mode switch
    registerZoomNotifier((zoom: number) => {
        events.fire('zoom:changed', zoom);
        app.renderNextFrame = true;
    });
    events.on('cameraMode:changed', () => resetZoom());

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
    initZoomIndicator(global);
    // anonymous usage analytics (inert no-op without settings.analytics); must
    // init before the Viewer so its 'inputEvent' listener registers ahead of
    // the camera manager's (it reads the pre-transition camera mode)
    initAnalytics(global);
    // engagement survey + lead CTA card (rides on analytics; inert without it)
    initSurvey(global);

    // Load model
    d?.('main: UI ready → loading scene…');
    const gsplatLoad = loadGsplat(
        app,
        config,
        (progress: number) => {
            state.progress = progress;
            d?.(`scene ${progress}%`);
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

    // Entry sound effects: a subtle two-part "arrival" — a door unlocking over
    // the loading screen, then an intro sting once you're standing in the room.
    //
    // When EMBEDDED (marketing site / customer iframe) the audio can't play from
    // here: iOS only unlocks audio from a gesture in the same document, and this
    // iframe never gets one before loading. The parent plays it, synced to the
    // real "Vollbild" launch gesture; the boot splash (index.html) posts
    // 'stepinside:viewerReady' at the fixed-arrival reveal to cue the parent's
    // intro. Nothing to do here for that path.

    // Built-in fallback for the TOP-LEVEL viewer (direct link / QR): there is no
    // parent to choreograph the audio and no gesture until the visitor taps, so
    // play the sequence on the first interaction after the scene is revealed.
    // The intro url falls back to the legacy `soundUrl` for older experiences.
    const sfx = global.settings.sound;
    const introUrl = sfx?.intro ?? global.settings.soundUrl;
    const doorUrl = sfx?.door;
    if (window.top === window.self && (introUrl || doorUrl)) {
        const volume = Math.max(0, Math.min(1, sfx?.volume ?? 0.6));
        const gapMs = sfx?.gap ?? 0;

        const makeAudio = (url?: string) => {
            if (!url) return null;
            const a = new Audio(url);
            a.crossOrigin = 'anonymous';
            a.preload = 'auto';
            a.volume = volume;
            return a;
        };
        const intro = makeAudio(introUrl);
        const door = makeAudio(doorUrl);

        const playDoor = () => {
            if (!door) return;
            door.currentTime = 0;
            door.volume = volume;
            window.setTimeout(() => door.play().catch(() => {}), Math.max(0, gapMs));
        };

        const playSequence = () => {
            // Unlock the door element WITHIN the gesture: a browser only lets an
            // element play later (from the intro's async 'ended') if it was
            // already blessed by a real, user-initiated play(). A *muted* play
            // does not grant that on iOS, so prime it unmuted but at volume 0 —
            // a silent real play — then restore the volume.
            if (door) {
                door.volume = 0;
                door.play().then(() => {
                    door.pause();
                    door.currentTime = 0;
                    door.volume = volume;
                }).catch(() => {
                    door.volume = volume;
                });
            }
            if (intro) {
                intro.addEventListener('ended', playDoor, { once: true });
                // If the intro can't play, still give the door its moment.
                intro.play().catch(playDoor);
            } else {
                playDoor();
            }
        };

        // Arm on the first interaction, but only once the scene is on screen —
        // a tap on the loading poster shouldn't fire the arrival. pointerdown
        // covers both touch and mouse and beats 'click' to the punch.
        const arm = () => {
            document.body.addEventListener('pointerdown', playSequence, {
                capture: true,
                once: true
            });
        };
        if (state.loaded) {
            arm();
        } else {
            events.on('loaded:changed', arm);
        }
    }

    // Audio elements that must fall silent when the embedding page HIDES the
    // viewer (collapsed back to the website — the iframe stays mounted and would
    // otherwise keep playing off-screen). Collected here; suspended/resumed by
    // the parent's visibility message near the end of main().
    const suspendable: HTMLAudioElement[] = [];

    // Footstep audio while auto-walking to a clicked point. Starts when a walk
    // actually begins (navTarget:set — fired only past the onboarding move-lock)
    // and stops the instant the walker arrives or the walk is cancelled
    // (navTarget:clear), with a short fade so a step isn't hard-clipped. The tap
    // that starts the walk is itself the gesture that unlocks audio on iOS, and
    // this runs in the viewer document, so it works embedded AND standalone.
    const footstepsUrl = sfx?.footsteps;
    if (footstepsUrl) {
        const steps = new Audio(footstepsUrl);
        steps.crossOrigin = 'anonymous';
        steps.preload = 'auto';
        steps.loop = true; // cover the rare walk longer than the clip
        suspendable.push(steps);
        const stepsVol = Math.max(0, Math.min(1, sfx?.footstepsVolume ?? 0.5));
        let fadeTimer = 0;
        const clearFade = () => {
            if (fadeTimer) {
                clearInterval(fadeTimer);
                fadeTimer = 0;
            }
        };

        events.on('navTarget:set', () => {
            // Only in walk mode — navTarget:set also fires for click-to-fly, and
            // footsteps while flying would be wrong.
            if (state.cameraMode !== 'walk') return;
            clearFade();
            steps.volume = stepsVol;
            // RESUME from where it paused (never reset to 0) so the long track
            // advances across walks — the footsteps vary instead of repeating the
            // same opening steps. `loop` wraps it round at the end.
            if (steps.paused) {
                steps.play().catch(() => {});
            }
        });

        events.on('navTarget:clear', () => {
            clearFade();
            if (steps.paused) return;
            // ~100 ms fade to silence, then PAUSE (keep the position) — reads as
            // "stops when you stop" without hard-clipping, and the next walk picks
            // up from here.
            const dec = stepsVol / 6;
            fadeTimer = window.setInterval(() => {
                steps.volume = Math.max(0, steps.volume - dec);
                if (steps.volume <= 0.001) {
                    clearFade();
                    steps.pause();
                    steps.volume = stepsVol;
                }
            }, 16);
        });
    }

    // Measurement SFX: a tick when the first point is placed (measureFirst) and a
    // confirmation when the second point finalises the measure (measureComplete).
    // Both fire from a tap, so audio is already unlocked; viewer-side, so it works
    // embedded and standalone.
    const measureStartUrl = sfx?.measureStart;
    const measureEndUrl = sfx?.measureEnd;
    if (measureStartUrl || measureEndUrl) {
        const mVol = Math.max(0, Math.min(1, sfx?.measureVolume ?? 0.4));
        const mkOneShot = (url?: string) => {
            if (!url) return null;
            const a = new Audio(url);
            a.crossOrigin = 'anonymous';
            a.preload = 'auto';
            a.volume = mVol;
            return a;
        };
        const mStart = mkOneShot(measureStartUrl);
        const mEnd = mkOneShot(measureEndUrl);
        if (mStart) suspendable.push(mStart);
        if (mEnd) suspendable.push(mEnd);
        const playOneShot = (a: HTMLAudioElement | null) => {
            if (!a) return;
            a.currentTime = 0;
            a.volume = mVol;
            a.play().catch(() => {});
        };
        events.on('measureFirst', () => playOneShot(mStart));
        events.on('measureComplete', () => playOneShot(mEnd));
    }

    // Drone (aerial) mode SFX: a looping ambient hum WHILE in aerial mode — it
    // starts on entering the drone and stops (fades) when leaving back to
    // walk/etc. — plus a take-off/fly-away one-shot each time the view is
    // switched (aerialNext / aerialPrev). Both are entered via a tap, so audio
    // is already unlocked.
    const droneAmbientUrl = sfx?.droneAmbient;
    const droneSwitchUrl = sfx?.droneSwitch;
    if (droneAmbientUrl || droneSwitchUrl) {
        const ambVol = Math.max(0, Math.min(1, sfx?.droneAmbientVolume ?? 0.5));
        const swVol = Math.max(0, Math.min(1, sfx?.droneSwitchVolume ?? 0.5));

        const ambient = droneAmbientUrl ? new Audio(droneAmbientUrl) : null;
        if (ambient) {
            ambient.crossOrigin = 'anonymous';
            // Lazy: the full ambient clip is a few MB — don't fetch it for the
            // many visitors who never open the drone. play() streams it on the
            // first aerial entry (a continuous hum tolerates the tiny start lag).
            ambient.preload = 'none';
            ambient.loop = true;
            ambient.volume = ambVol;
        }
        const sw = droneSwitchUrl ? new Audio(droneSwitchUrl) : null;
        if (sw) {
            sw.crossOrigin = 'anonymous';
            sw.preload = 'auto';
            sw.volume = swVol;
        }
        if (ambient) suspendable.push(ambient);
        if (sw) suspendable.push(sw);

        let ambFade = 0;
        const clearAmbFade = () => {
            if (ambFade) {
                clearInterval(ambFade);
                ambFade = 0;
            }
        };

        events.on('cameraMode:changed', () => {
            if (!ambient) return;
            if (state.cameraMode === 'aerial') {
                clearAmbFade();
                ambient.volume = ambVol;
                if (ambient.paused) {
                    ambient.play().catch(() => {});
                }
            } else if (!ambient.paused) {
                // fade the hum out over ~300ms when leaving the drone
                clearAmbFade();
                const dec = ambVol / 10;
                ambFade = window.setInterval(() => {
                    ambient.volume = Math.max(0, ambient.volume - dec);
                    if (ambient.volume <= 0.001) {
                        clearAmbFade();
                        ambient.pause();
                        ambient.currentTime = 0;
                        ambient.volume = ambVol;
                    }
                }, 30);
            }
        });

        events.on('inputEvent', (name: string) => {
            if (!sw) return;
            if ((name === 'aerialNext' || name === 'aerialPrev') && state.cameraMode === 'aerial') {
                sw.currentTime = 0;
                sw.volume = swVol;
                sw.play().catch(() => {});
            }
        });
    }

    // Drone view-switch polish — a subtle AUTOFOCUS HUNT. On a view change the
    // camera briefly loses focus and quickly hunts to lock it (defocus → rack in
    // → small overshoot → settle sharp), like a real drone camera refocusing.
    // Short (~0.5s) and scene-only via the Web Animations API — fill defaults to
    // 'none', so nothing lingers on the canvas afterwards.
    {
        const sceneCanvas = app.graphicsDevice.canvas as HTMLCanvasElement;
        let focusAnim: Animation | null = null;
        const refocus = () => {
            focusAnim?.cancel();
            focusAnim = sceneCanvas.animate([
                { filter: 'blur(6px)' },            // lost focus as the shot changes
                { filter: 'blur(0.4px)', offset: 0.42 }, // racks in fast
                { filter: 'blur(2.4px)', offset: 0.58 }, // overshoots — the "hunt"
                { filter: 'blur(0.3px)', offset: 0.78 }, // back toward sharp
                { filter: 'blur(1px)', offset: 0.88 },   // tiny second pump
                { filter: 'blur(0px)' }              // locks sharp
            ], { duration: 520, easing: 'ease-out' });
        };
        events.on('inputEvent', (name: string) => {
            if ((name === 'aerialNext' || name === 'aerialPrev') && state.cameraMode === 'aerial') {
                refocus();
            }
        });
        events.on('cameraMode:changed', () => {
            if (state.cameraMode !== 'aerial') {
                focusAnim?.cancel();
                focusAnim = null;
            }
        });
    }

    // "Möbliert" staging reveal SFX: plays as the furnished room is unveiled
    // after the loader (staging.ts fires 'stagingReveal'). The reveal is async
    // (post-loader), so it isn't inside a gesture — prime the element on
    // 'stagingStart' (fired within the pill click) so iOS lets it play later.
    const stagingRevealUrl = sfx?.stagingReveal;
    if (stagingRevealUrl) {
        const reveal = new Audio(stagingRevealUrl);
        reveal.crossOrigin = 'anonymous';
        reveal.preload = 'auto';
        const revVol = Math.max(0, Math.min(1, sfx?.stagingRevealVolume ?? 0.4));
        reveal.volume = revVol;
        suspendable.push(reveal);

        let primed = false;
        events.on('stagingStart', () => {
            if (primed) return;
            primed = true;
            // silent real play → unlocks the element for the later async reveal
            reveal.volume = 0;
            reveal.play().then(() => {
                reveal.pause();
                reveal.currentTime = 0;
                reveal.volume = revVol;
            }).catch(() => {
                reveal.volume = revVol;
            });
        });
        events.on('stagingReveal', () => {
            reveal.currentTime = 0;
            reveal.volume = revVol;
            reveal.play().catch(() => {});
        });
    }

    // Suspend all viewer audio when the embedding page hides the viewer (the
    // "close"/collapse on the website keeps the iframe mounted, so a loop like
    // the drone hum would otherwise keep playing off-screen). Resume whatever was
    // playing when it's shown again. Message is posted by the parent (Demos.tsx).
    if (window.parent && window.parent !== window) {
        let suspendedPlaying: HTMLAudioElement[] = [];
        window.addEventListener('message', (e: MessageEvent) => {
            if (e.source !== window.parent) return;
            const data = e.data as { type?: string, visible?: boolean } | null;
            if (data?.type !== 'stepinside:visibility') return;
            if (data.visible === false) {
                suspendedPlaying = suspendable.filter(a => !a.paused);
                suspendedPlaying.forEach(a => a.pause());
            } else {
                suspendedPlaying.forEach(a => a.play().catch(() => {}));
                suspendedPlaying = [];
            }
        });
    }

    // Create the viewer
    return new Viewer(global, gsplatLoad, skyboxLoad, collisionLoad);
};

console.log(`StepInside Viewer v${appVersion} | Engine v${engineVersion} (${engineRevision})`);

export { main };
