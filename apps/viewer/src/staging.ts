import type { Global } from './types';

// AI virtual staging ("Möbliert sehen"). A glass pill bottom-left renders the
// current view, sends it to the staging endpoint (server-side Gemini) and lays
// the furnished still over the live scan. You can switch between scan and
// furnished (tap the toggle, or press-and-hold the image to peek at the scan),
// and close to carry on walking.
//
// MVP: on-demand generation, no caching/pinning yet. The camera never moves
// while the overlay is up (the overlay covers the canvas, so no input reaches
// it), so closing lands you exactly where you were — ideal paired with the
// bird's-eye (drone) viewpoints, which are fixed curated angles.

// Shape of the /stage endpoint's JSON response.
type StageResponse = {
    image?: string,        // data URL of the furnished image
    style?: string,
    error?: string
};

// Longest edge (px) we downscale the captured frame to before sending. Keeps
// the upload small and the per-image cost predictable; the model re-renders at
// its own resolution anyway.
const MAX_CAPTURE_EDGE = 1536;

// Which curated bird's-eye (drone) viewpoint to stage from. Staging always
// frames the room from this single fixed angle, so every style is generated
// from the same vantage and the result is reproducible. MUST match the index
// into `aerialViews` in camera-manager.ts. We want the LENGTHWISE view (camera
// at one end wall, looking down the room toward the opposite wall) so the room
// reads long/deep — index 0 ("wide, from the front") or 1 ("from the back");
// NOT index 2 (the across/broad view). Set to 0; flip to 1 if it films from
// the wrong end.
const STAGING_AERIAL_INDEX = 0;

// In 'demo' mode the loader plays for roughly this long (on top of the camera
// fly) before the pre-generated image is revealed, so the wait still feels like
// a real generation without making (paid) API calls.
const DEMO_DELAY_MS = 6000;

const initStaging = (global: Global) => {
    const { app, settings, state, events, renderer, config } = global;

    // Cast-through config (not part of the validated schema core; see v2.ts).
    const cfg = settings.staging;
    if (!cfg?.enabled) return;
    // 'demo' shows pre-generated images (no API cost); 'live' calls the endpoint.
    const demoMode = cfg.mode === 'demo';
    const endpoint = cfg.endpoint ?? '';
    const propertyId = cfg.propertyId ?? '';
    // Live mode needs a real endpoint + property; demo mode needs neither.
    if (!demoMode && (!endpoint || !propertyId)) return;
    const styles = cfg.styles ?? [];
    // Narrow/portrait screens (phones) get the 9:16 image; everything else the
    // landscape one. Falls back to the landscape image if no portrait is set.
    const isPortrait = () => window.matchMedia('(max-width: 600px)').matches;
    // Per-scan staging images are stored RELATIVE to the scan's asset base
    // (settings.staging.styles[].image = "staged/x.jpg"). When the scan was
    // loaded via ?assets=, resolve them against that base so the correct images
    // load — page-relative resolution would hit the site's own demo /staged/
    // folder (the bug that showed the old Altbau image on every scan). Absolute /
    // data: / root paths pass through. The default demo (no ?assets=) is unchanged.
    const resolveImg = (p: string | undefined): string | undefined => {
        if (!p || !config.assetsExplicit || !config.assets) return p;
        if (/^(https?:|data:|\/)/i.test(p)) return p;
        return `${config.assets.replace(/\/+$/, '')}/${p}`;
    };
    const styleImage = (id: string | undefined): string | undefined => {
        const s = styles.find(s => s.id === id);
        if (!s) return undefined;
        return resolveImg((isPortrait() && s.imagePortrait) ? s.imagePortrait : s.image);
    };
    // Per-style furnishing clip (landscape / desktop only — the clips are 16:9).
    const styleVideo = (id: string | undefined): string | undefined => {
        const s = styles.find(s => s.id === id) as (undefined | { video?: string });
        return resolveImg(s?.video);
    };
    const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

    const pill = document.getElementById('stagePill');
    const trigger = document.getElementById('stageTrigger');
    const label = document.getElementById('stageLabel');
    const overlay = document.getElementById('stageOverlay');
    const img = document.getElementById('stageImage') as HTMLImageElement | null;
    // Hidden playback element for the DESKTOP furnishing timelapse. Absent-safe:
    // everything degrades to the plain still-image reveal if it or a clip is missing.
    const video = document.getElementById('stageVideo') as HTMLVideoElement | null;
    const closeBtn = document.getElementById('stageClose');
    const statusEl = document.getElementById('stageStatus');
    const statusText = document.getElementById('stageStatusText');
    const prevBtn = document.getElementById('stagePrev');
    const nextBtn = document.getElementById('stageNext');
    const nameEl = document.getElementById('stageStyleName');
    const hintEl = document.getElementById('stageHint');   // optional press-and-hold coach hint
    if (!pill || !trigger || !label || !overlay || !img || !closeBtn || !statusEl || !statusText || !prevBtn || !nextBtn || !nameEl) return;

    // The pill stays hidden until it is actually usable. In demo mode that is
    // immediately (images are local). In live mode we keep it hidden until the
    // background pre-generation for the default style has landed, then fade it in
    // — so a click always shows a finished image, never a 60s wait (see prewarm
    // below). A misconfigured build therefore also never shows a dead button.
    let pillRevealed = false;
    const revealPill = () => {
        if (pillRevealed) return;
        pillRevealed = true;
        pill.classList.remove('hidden');
        // soft entrance (fade + slight rise); class self-clears after the anim
        trigger.classList.add('is-revealing');
        window.setTimeout(() => trigger.classList.remove('is-revealing'), 600);
    };
    if (demoMode) {
        revealPill();
        // Warm the default style's clip so the first reveal plays without a
        // buffering stall behind the loader. Desktop/landscape only — the clips
        // are 16:9 and phones (portrait) use the still-image flow instead.
        if (video && !isPortrait()) {
            const firstClip = styleVideo(styles[0]?.id);
            if (firstClip) { video.src = firstClip; video.load(); }
        }
    }

    let loading = false;
    let styleIndex = 0;
    let selectedStyle: string | undefined = styles[0]?.id;
    // true = furnished image shown; false = scan (live canvas) shown through.
    let showingFurnished = true;

    // One generated image per style, kept for the page session. This is what
    // stops tokens being burned on repeat clicks: each style is generated at
    // most once; reopening the overlay or reselecting a style shows the cached
    // image instead of calling the model again.
    const cache = new Map<string, string>();

    const setLabel = (text: string) => {
        label.textContent = text;
        // idle = just the sofa icon; any status/error briefly expands to a label
        trigger.classList.toggle('has-message', text !== 'Möbliert sehen');
    };

    // Show/hide the furnished image over the scan. Hiding it just drops the
    // overlay image's opacity so the live canvas shows through underneath.
    const setShowing = (furnished: boolean) => {
        showingFurnished = furnished;
        overlay.classList.toggle('is-scan', !furnished);
    };

    // The furnished image currently on screen (for reverting after a failed
    // style switch without losing the good result behind it).
    let shownUrl: string | undefined;

    // Coach hint teaching the press-and-hold-for-original gesture. It fades in a
    // couple of seconds after the reveal, then PULSES and STAYS until the visitor
    // has performed the gesture once (`peekedOnce`); after that it never returns.
    let peekedOnce = false;
    const hintTimers: number[] = [];
    const clearHintTimers = () => {
        while (hintTimers.length) window.clearTimeout(hintTimers.pop());
    };
    const hideHint = () => {
        if (!hintEl) return;
        clearHintTimers();
        hintEl.classList.remove('is-visible', 'is-pulsing');
        hintTimers.push(window.setTimeout(() => hintEl.classList.add('hidden'), 500));
    };
    const maybeShowHint = () => {
        if (!hintEl || peekedOnce) return;
        if (hintEl.classList.contains('is-visible')) return;   // already up
        clearHintTimers();
        hintTimers.push(window.setTimeout(() => {
            if (peekedOnce || overlay.classList.contains('hidden') || !showingFurnished) return;
            hintEl.classList.remove('hidden');
            void hintEl.offsetWidth;             // restart the fade-in transition
            hintEl.classList.add('is-visible');  // soft fade in
            // then throb; it stays visible until the gesture is performed
            hintTimers.push(window.setTimeout(() => {
                if (!peekedOnce) hintEl.classList.add('is-pulsing');
            }, 520));
        }, 1800));
    };

    // Show the finished furnished image (no loading state); soft-reveal it.
    const showResult = (dataUrl: string) => {
        overlay.classList.remove('hidden', 'is-scan', 'is-generating', 'is-videostage', 'is-filling');
        overlay.style.removeProperty('--stage-loader-dur');
        if (video) { video.pause(); }
        state.controlsHidden = true;   // get the chrome out of the way
        document.body.classList.add('staging-open');   // fully hide normal chrome
        img.src = dataUrl;
        shownUrl = dataUrl;
        // restart the reveal animation each time
        img.classList.remove('is-revealed');
        void img.offsetWidth;
        img.classList.add('is-revealed');
        setShowing(true);
        maybeShowHint();
    };

    // Start the timelapse (its src + the loader fill are already set upfront, so its
    // first frame and the logo motion appear immediately — no standstill) and
    // resolve once it reaches its endframe. A safety cap resolves anyway if the
    // clip stalls, so the reveal never hangs.
    const playStagingVideoTimed = (): Promise<void> => new Promise((resolve) => {
        if (!video) { resolve(); return; }
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            video.removeEventListener('ended', finish);
            video.removeEventListener('error', finish);
            window.clearTimeout(safety);
            resolve();
        };
        video.addEventListener('ended', finish);
        video.addEventListener('error', finish);
        const safety = window.setTimeout(finish, 15000);
        try {
            video.currentTime = 0;
            const p = video.play();
            if (p && typeof p.catch === 'function') p.catch(() => { /* ignore autoplay quirk */ });
        } catch {
            finish();
        }
    });

    // Reveal: the crisp still fades in ON TOP of the clip's last furnished frame
    // (the clip stays behind as the backdrop, so the room is never seen empty),
    // then the clip is dropped once the still is fully up. Same reveal animation as
    // the plain still path; the caller fires the SFX.
    const revealStillOverVideo = (dataUrl: string) => {
        overlay.classList.remove('hidden', 'is-scan', 'is-generating');
        img.src = dataUrl;                  // warmed beforehand → paints instantly
        img.classList.remove('is-revealed');
        void img.offsetWidth;
        img.classList.add('is-revealed');   // fades in over the furnished clip frame
        state.controlsHidden = true;
        document.body.classList.add('staging-open');
        shownUrl = dataUrl;
        setShowing(true);
        maybeShowHint();
        window.setTimeout(() => {
            overlay.classList.remove('is-videostage', 'is-filling');
            if (video) video.pause();
        }, 560);
    };

    // Open the overlay in its generating state IMMEDIATELY (so the logo loader
    // drops in the instant the user clicks). No backdrop is set: for a fresh
    // generation a dark scrim shows behind the loader; for a style switch the
    // previous furnished image stays as a dimmed backdrop. The camera fly +
    // capture then happen hidden behind the loader.
    const openGenerating = (message: string) => {
        statusText.textContent = message;
        overlay.classList.remove('hidden', 'is-scan');
        overlay.classList.add('is-generating');   // restarts the logo fill
        state.controlsHidden = true;
        document.body.classList.add('staging-open');   // fully hide normal chrome
    };

    const closeOverlay = () => {
        overlay.classList.add('hidden');
        overlay.classList.remove('is-scan', 'is-generating', 'is-videostage', 'is-filling');
        overlay.style.removeProperty('--stage-loader-dur');
        if (video) { video.pause(); }
        img.classList.remove('is-revealed');
        img.removeAttribute('src');
        shownUrl = undefined;
        hideHint();
        setLabel('Möbliert sehen');
        state.controlsHidden = false;   // bring the viewer chrome back
        document.body.classList.remove('staging-open');
    };

    // A generation failed: keep the previous result if there was one, otherwise
    // close the overlay. Then surface a short message on the pill.
    const failBack = (message: string) => {
        if (shownUrl) {
            overlay.classList.remove('is-generating');
            setShowing(true);
        } else {
            closeOverlay();
        }
        setLabel(message);
        window.setTimeout(() => setLabel('Möbliert sehen'), 3000);
    };

    // Read the on-screen canvas into a downscaled JPEG data URL. The canvas
    // holds the rendered scene only; the viewer UI is separate HTML overlay, so
    // this is already a clean room image with no chrome to crop out.
    const grabCanvas = (): string => {
        const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
        const srcW = canvas.width;
        const srcH = canvas.height;
        if (!srcW || !srcH) throw new Error('empty canvas');

        const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(srcW, srcH));
        const w = Math.max(1, Math.round(srcW * scale));
        const h = Math.max(1, Math.round(srcH * scale));

        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        // opaque white backdrop just in case the canvas has alpha (JPEG has none)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0, w, h);
        return off.toDataURL('image/jpeg', 0.9);
    };

    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    // Capture the current view. The trick differs by backend:
    //   WebGPU — the swapchain texture is only readable once the frame has been
    //     submitted and presented, which happens after `postrender`. So we force
    //     a render and read on a later rAF, when the presented frame is on the
    //     canvas. (Reading at postrender or via copyRenderTarget comes back blank
    //     on WebGPU here.)
    //   WebGL — without preserveDrawingBuffer the buffer is cleared after the
    //     frame composites, so we must read inside the same frame, at postrender.
    const captureFrame = async (): Promise<string> => {
        if (renderer === 'webgpu') {
            app.renderNextFrame = true;
            await nextFrame();           // this rAF renders the frame
            app.renderNextFrame = true;
            await nextFrame();           // submitted + presented
            await nextFrame();
            return grabCanvas();
        }
        // WebGL: read synchronously in the same frame, before the buffer clears.
        return new Promise<string>((resolve, reject) => {
            app.once('postrender', () => {
                try {
                    resolve(grabCanvas());
                } catch (err) {
                    reject(err as Error);
                }
            });
            app.renderNextFrame = true;
        });
    };

    const setLoading = (value: boolean) => {
        loading = value;
        trigger.classList.toggle('is-loading', value);
        (trigger as HTMLButtonElement).disabled = value;
    };

    // Fly the camera to the fixed staging drone view and resolve once it has
    // settled, so the captured frame is the steady overview, not a mid-glide
    // blur. Resolves on the 'aerialArrived' signal (or a safety timeout).
    const goToStagingAerial = (): Promise<void> => new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            events.off('aerialArrived', onArrived);
            window.clearTimeout(timer);
            resolve();
        };
        const onArrived = () => finish();
        events.on('aerialArrived', onArrived);
        const timer = window.setTimeout(finish, 2500);
        events.fire('inputEvent', 'aerialGoto', STAGING_AERIAL_INDEX);
    });

    // Show a style. Cached styles open instantly (no model call); a new style is
    // generated once from the fixed drone overview, then cached. Defaults to the
    // currently selected style (the pill).
    const generate = async (styleId: string | undefined = selectedStyle) => {
        if (loading) return;

        // Signal the staging start WITHIN the click gesture so the reveal SFX can
        // be unlocked (primed) for iOS — the reveal itself happens async later.
        events.fire('stagingStart');

        // Cache per style AND orientation (portrait/landscape use different
        // images), so rotating the device still shows the right one.
        const key = styleId ? `${styleId}:${isPortrait() ? 'p' : 'l'}` : undefined;

        // Already generated this style? Reuse it — no network, no tokens.
        const cached = key ? cache.get(key) : undefined;
        if (cached) {
            showResult(cached);
            setLabel('Möbliert sehen');
            return;
        }

        if (!demoMode && !navigator.onLine) {
            setLabel('Keine Verbindung');
            window.setTimeout(() => setLabel('Möbliert sehen'), 2500);
            return;
        }

        setLoading(true);

        // Desktop/landscape only: a per-style furnishing timelapse plays visibly
        // with the loader logo on top; phones (portrait) keep the plain still.
        const videoUrl = (demoMode && !isPortrait()) ? styleVideo(styleId) : undefined;
        const useVideo = !!(videoUrl && video);

        if (useVideo && videoUrl && video) {
            // Prime the clip + loader BEFORE the overlay opens, so the first frame
            // and the logo fill appear the instant the loader drops in — no
            // standstill. The drone fly runs concurrently (the clip covers the
            // canvas), so nothing waits on it.
            img.removeAttribute('src');                                   // still stays hidden until the reveal
            if (video.getAttribute('src') !== videoUrl) video.src = videoUrl;
            overlay.classList.add('is-videostage', 'is-filling');
        }

        // Drop the loader in immediately.
        openGenerating('Der Raum wird eingerichtet');

        // Demo mode: no capture, no API call.
        if (demoMode) {
            const image = styleImage(styleId);

            // Desktop, FIRST view of a style: the timelapse plays (motion starts
            // immediately), the drone fly runs CONCURRENTLY, then the crisp still
            // fades in over the final furnished frame — the room is never seen empty.
            // Cached afterwards → later skips between styles show the plain stills.
            if (useVideo && videoUrl) {
                if (image) { const pre = new Image(); pre.src = image; }  // warm the still so it paints instantly
                void goToStagingAerial();                                  // concurrent — no dead wait on the fly
                await playStagingVideoTimed();
                if (image) {
                    if (key) cache.set(key, image);
                    revealStillOverVideo(image);
                    events.fire('stagingReveal');   // still fades in → SFX
                    setLabel('Möbliert sehen');
                } else {
                    failBack('Kein Bild hinterlegt');
                }
                setLoading(false);
                return;
            }

            // Still path (portrait / no clip): fly, warm the image, hold the loader
            // for a realistic beat, then reveal the pre-generated picture.
            await goToStagingAerial();
            if (image) {
                const pre = new Image();
                pre.src = image;
                await wait(DEMO_DELAY_MS);
                if (key) cache.set(key, image);
                showResult(image);
                events.fire('stagingReveal');
                setLabel('Möbliert sehen');
            } else {
                failBack('Kein Bild hinterlegt');
            }
            setLoading(false);
            return;
        }

        // Live path: fly to the fixed drone overview, then capture.
        await goToStagingAerial();

        let dataUrl: string;
        try {
            dataUrl = await captureFrame();
        } catch (err) {
            console.warn('Frame capture failed:', err);
            setLoading(false);
            failBack('Aufnahme fehlgeschlagen');
            return;
        }

        // Source frame dimensions let the server pick a matching output aspect.
        const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    propertyId,
                    image: dataUrl,
                    style: styleId,
                    width: canvas.width,
                    height: canvas.height
                })
            });

            if (!res.ok) {
                if (res.status === 429) {
                    // The server sends 429 for both short-term rate limits and
                    // the daily spend cap; the latter sets Retry-After to the
                    // seconds until UTC midnight (always > 1h).
                    const retryAfter = parseInt(res.headers.get('retry-after') ?? '', 10);
                    failBack(retryAfter > 3600 ?
                        'Das tägliche Kontingent ist erreicht. Morgen geht\'s weiter.' :
                        'Zu viele Anfragen. Bitte warte einen Moment.');
                } else {
                    failBack('Hat nicht geklappt. Bitte gleich nochmal.');
                }
                return;
            }

            const data = await res.json() as StageResponse;
            if (typeof data.image === 'string' && data.image.length > 0) {
                if (key) cache.set(key, data.image);
                showResult(data.image);
                events.fire('stagingReveal');   // reveal after the loader → SFX
                setLabel('Möbliert sehen');
            } else {
                failBack('Kein Bild erhalten');
            }
        } catch (err) {
            console.warn('Staging request failed:', err);
            failBack('Hat nicht geklappt. Bitte gleich nochmal.');
        } finally {
            setLoading(false);
        }
    };

    // Style arrows (left/right screen edges) cycle through the styles (only when
    // >1 offered); the bottom bar shows the current style name + "Original zeigen".
    const showStyleName = () => {
        nameEl.textContent = styles[styleIndex]?.label ?? '';
    };
    const step = (dir: number) => {
        if (loading || styles.length < 2) return;
        const n = styles.length;
        styleIndex = (styleIndex + dir + n) % n;
        selectedStyle = styles[styleIndex]?.id;
        showStyleName();
        // anonymous usage signal (no-op unless analytics is configured)
        events.fire('analytics', 'staging', { action: 'style', style: selectedStyle });
        // generate() handles the rest: cached styles swap in instantly, new ones
        // show the generating loader.
        generate(selectedStyle);
    };
    if (styles.length > 1) {
        prevBtn.addEventListener('click', (event) => {
            event.stopPropagation(); step(-1);
        });
        nextBtn.addEventListener('click', (event) => {
            event.stopPropagation(); step(1);
        });
        prevBtn.classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        // the style name stays hidden: the bottom bar shows only "Original zeigen"
    }

    // Pill: kick off a generation.
    trigger.addEventListener('click', () => {
        // anonymous usage signal (no-op unless analytics is configured)
        events.fire('analytics', 'staging', { action: 'open', style: selectedStyle });
        generate();
    });

    // Overlay controls. Stop pointer/wheel from reaching the canvas/camera.
    overlay.addEventListener('wheel', event => event.stopPropagation());

    closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeOverlay();
    });

    // Press-and-hold anywhere on the image to peek at the live scan, release to
    // return to the furnished view. Pointer events cover mouse + touch.
    const peekStart = (event: PointerEvent) => {
        // ignore presses that start on a control (toggle/close/style chips)
        if ((event.target as HTMLElement).closest('button')) return;
        if (!showingFurnished) return;
        peekedOnce = true;      // gesture performed — the coach hint never returns
        hideHint();
        overlay.classList.add('is-scan');
    };
    const peekEnd = () => {
        if (showingFurnished) overlay.classList.remove('is-scan');
    };
    overlay.addEventListener('pointerdown', peekStart);
    overlay.addEventListener('pointerup', peekEnd);
    overlay.addEventListener('pointercancel', peekEnd);
    overlay.addEventListener('pointerleave', peekEnd);

    // Esc closes the overlay (mirrors the viewer's cancel convention).
    events.on('inputEvent', (type: string) => {
        if (type === 'cancel' && !overlay.classList.contains('hidden')) {
            closeOverlay();
        }
    });

    // ---- Silent background prewarm (live mode only) ----------------------------
    // The model takes ~60s/image. To make that wait invisible, we generate the
    // DEFAULT style in the background the moment the scene is ready: fly to the
    // fixed drone view behind an opaque cover (the visitor never sees it and has
    // no control yet — the spec's "Lade-/Poster-Phase" capture), grab the frame
    // with the proven on-canvas capture, glide back to the start pose, drop the
    // cover, and POST while the visitor walks/onboards. The pill only appears once
    // the result is in the cache, so the first click is instant. The other two
    // styles stay on-demand (generate() handles them) to keep token cost to one
    // image per load.
    if (!demoMode && styles.length > 0) {
        // Gate onboarding NOW (synchronously, before firstFrame): the tutorial's
        // 'look' leg watches camera yaw, so it must not run during our sweep.
        state.prewarming = true;

        // Full-screen cover, created hidden up front so showing it at firstFrame is
        // a single synchronous class flip (no paint between poster-hide and cover).
        const cover = document.createElement('div');
        cover.id = 'stagePrewarmCover';
        cover.className = 'hidden';
        document.body.appendChild(cover);

        const prewarmDefault = async () => {
            const styleId = styles[0]?.id;
            const key = styleId ? `${styleId}:${isPortrait() ? 'p' : 'l'}` : undefined;
            if (!styleId || !key) {
                state.prewarming = false; revealPill(); return;
            }

            cover.classList.remove('hidden');   // hide the camera detour from the visitor

            let dataUrl: string | undefined;
            try {
                await goToStagingAerial();      // glide up to the fixed drone view
                dataUrl = await captureFrame(); // proven single-camera, correctly-sorted capture
            } catch (err) {
                console.warn('Prewarm capture failed:', err);
            } finally {
                // Toggle-exit aerial -> glide back to exactly the start pose, settle,
                // then lift the cover and release the onboarding gate.
                events.fire('inputEvent', 'aerial');
                await wait(1200);               // no 'arrived' signal on exit; ~match the glide
                app.renderNextFrame = true;
                cover.classList.add('is-fading');
                window.setTimeout(() => {
                    cover.classList.add('hidden'); cover.classList.remove('is-fading');
                }, 450);
                state.prewarming = false;       // re-runs the tutorial's start check
            }

            if (!dataUrl) {
                revealPill(); return;
            }   // capture failed: degrade to on-click live gen

            const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        propertyId,
                        image: dataUrl,
                        style: styleId,
                        width: canvas.width,
                        height: canvas.height
                    })
                });
                if (res.ok) {
                    const data = await res.json() as StageResponse;
                    if (typeof data.image === 'string' && data.image.length > 0) {
                        cache.set(key, data.image);
                        const pre = new Image();   // warm the decode so the first click paints instantly
                        pre.src = data.image;
                    }
                }
            } catch (err) {
                console.warn('Prewarm generation failed:', err);
            } finally {
                // Reveal regardless: a hit shows instantly, a miss falls back to the
                // normal on-click generation (with its loader) so the feature is
                // never lost. firstFrame fires once, so this runs at most once.
                revealPill();
            }
        };

        events.on('firstFrame', prewarmDefault);
    }
};

export { initStaging };
