import { EventHandler } from 'playcanvas';

import { version as appVersion } from '../package.json';
import { localize } from './localization';
import type { Annotation } from './settings';
import { Tooltip } from './tooltip';
import { Global } from './types';

// Initialize the touch joystick for fly mode camera control
const initJoystick = (
    dom: Record<string, HTMLElement>,
    events: EventHandler,
    state: { cameraMode: string; inputMode: string; gamingControls: boolean }
) => {
    // Joystick dimensions (matches SCSS: base height=100, stick size=40)
    const joystickHeight = 100;
    const stickSize = 40;
    const stickCenterY = (joystickHeight - stickSize) / 2; // 30px - top position when centered
    const stickCenterX = (joystickHeight - stickSize) / 2; // 30px - left position when centered (for 2D mode)
    const maxStickTravel = stickCenterY; // can travel 30px up or down from center

    // Fixed joystick position (bottom-left corner with safe area)
    const joystickFixedX = 70;
    const joystickFixedY = () => window.innerHeight - 140;

    // Joystick touch state
    let joystickPointerId: number | null = null;
    let joystickValueX = 0; // -1 to 1, negative = left, positive = right
    let joystickValueY = 0; // -1 to 1, negative = forward, positive = backward

    // Joystick mode: '1d' for vertical only, '2d' for full directional
    let joystickMode: '1d' | '2d' = '2d';

    // Double-tap detection for mode toggle
    let lastTapTime = 0;

    // Update joystick visibility based on camera mode and input mode
    const updateJoystickVisibility = () => {
        if ((state.cameraMode === 'fly' || state.cameraMode === 'walk') && state.inputMode === 'touch' && state.gamingControls) {
            dom.joystickBase.classList.remove('hidden');
            dom.joystickBase.classList.toggle('mode-2d', joystickMode === '2d');
            dom.joystickBase.style.left = `${joystickFixedX}px`;
            dom.joystickBase.style.top = `${joystickFixedY()}px`;
            // Center the stick
            dom.joystick.style.top = `${stickCenterY}px`;
            if (joystickMode === '2d') {
                dom.joystick.style.left = `${stickCenterX}px`;
            } else {
                dom.joystick.style.left = '8px'; // Reset to 1D centered position
            }
        } else {
            dom.joystickBase.classList.add('hidden');
        }
    };

    events.on('cameraMode:changed', updateJoystickVisibility);
    events.on('inputMode:changed', updateJoystickVisibility);
    events.on('gamingControls:changed', updateJoystickVisibility);
    window.addEventListener('resize', updateJoystickVisibility);

    // Handle joystick touch input directly on the joystick element
    const updateJoystickStick = (clientX: number, clientY: number) => {
        const baseY = joystickFixedY();
        // Calculate Y offset from joystick center (positive = down/backward)
        const offsetY = clientY - baseY;
        // Clamp to max travel and normalize to -1 to 1
        const clampedOffsetY = Math.max(-maxStickTravel, Math.min(maxStickTravel, offsetY));
        joystickValueY = clampedOffsetY / maxStickTravel;

        // Update stick visual Y position
        dom.joystick.style.top = `${stickCenterY + clampedOffsetY}px`;

        // Handle X axis in 2D mode
        if (joystickMode === '2d') {
            const baseX = joystickFixedX;
            const offsetX = clientX - baseX;
            const clampedOffsetX = Math.max(-maxStickTravel, Math.min(maxStickTravel, offsetX));
            joystickValueX = clampedOffsetX / maxStickTravel;

            // Update stick visual X position
            dom.joystick.style.left = `${stickCenterX + clampedOffsetX}px`;
        } else {
            joystickValueX = 0;
        }

        // Fire input event for the input controller
        events.fire('joystickInput', { x: joystickValueX, y: joystickValueY });
    };

    dom.joystickBase.addEventListener('pointerdown', (event: PointerEvent) => {
        // Double-tap detection for mode toggle
        const now = Date.now();
        if (now - lastTapTime < 300) {
            joystickMode = joystickMode === '1d' ? '2d' : '1d';
            updateJoystickVisibility();
            lastTapTime = 0;
        } else {
            lastTapTime = now;
        }

        if (joystickPointerId !== null) return; // Already tracking a touch

        joystickPointerId = event.pointerId;
        dom.joystickBase.setPointerCapture(event.pointerId);

        updateJoystickStick(event.clientX, event.clientY);
        event.preventDefault();
        event.stopPropagation();
    });

    dom.joystickBase.addEventListener('pointermove', (event: PointerEvent) => {
        if (event.pointerId !== joystickPointerId) return;

        updateJoystickStick(event.clientX, event.clientY);
        event.preventDefault();
    });

    const endJoystickTouch = (event: PointerEvent) => {
        if (event.pointerId !== joystickPointerId) return;

        joystickPointerId = null;
        joystickValueX = 0;
        joystickValueY = 0;

        // Reset stick to center
        dom.joystick.style.top = `${stickCenterY}px`;
        if (joystickMode === '2d') {
            dom.joystick.style.left = `${stickCenterX}px`;
        }

        // Fire input event with zero values
        events.fire('joystickInput', { x: 0, y: 0 });

        dom.joystickBase.releasePointerCapture(event.pointerId);
    };

    dom.joystickBase.addEventListener('pointerup', endJoystickTouch);
    dom.joystickBase.addEventListener('pointercancel', endJoystickTouch);
};

// Initialize the annotation navigator for stepping between annotations
const initAnnotationNav = (
    dom: Record<string, HTMLElement>,
    events: EventHandler,
    state: { loaded: boolean; inputMode: string; controlsHidden: boolean; heroStill: boolean },
    annotations: Annotation[]
) => {
    // Only show navigator when there are at least 2 annotations
    if (annotations.length < 2) return;

    let currentIndex = 0;

    // Until the visitor engages with the navigator, the pill labels ITSELF
    // ("Highlights") instead of showing an arbitrary first annotation title —
    // otherwise the bar reads like a caption, not a control.
    let engaged = false;

    const updateDisplay = () => {
        dom.annotationNavTitle.textContent = engaged ?
            (annotations[currentIndex].title || '') :
            'Highlights';
    };

    const updateMode = () => {
        if (!state.loaded) return;
        dom.annotationNav.classList.remove('desktop', 'touch', 'hidden');
        dom.annotationNav.classList.add(state.inputMode);
    };

    // The Highlights pill runs INVERTED against the rest of the chrome: while the
    // visitor is moving it gets out of the way (the tour is about the room, not
    // the UI), and it returns about a second after the camera comes to rest. So
    // the screen is clear for most of the walk-through.
    //
    // Driven by camera stillness, not the shared 4 s idle timer — that one reacts
    // to INPUT, and "standing still" is what this should answer to. heroStill on
    // its own is too twitchy (it flips after 200 ms and drops on the tiniest
    // nudge), so the two directions are asymmetric: hiding is immediate, showing
    // is debounced. Motion clears the screen at once; the pill only comes back
    // after a real pause, never flickering during a look-around.
    // (Staging is unaffected — body.staging-open hides #annotationNav via CSS.)
    // Kept short on purpose: the pill is also how a visitor DISCOVERS that the
    // highlights exist, so it has to arrive while the pause still feels like the
    // same moment. Together with heroStill's own 200 ms that lands at ~0.6 s
    // after the camera stops — quick enough to be noticed, long enough that a
    // micro-pause mid-look-around doesn't flash it.
    const PILL_SETTLE_MS = 400;
    let pillTimer: ReturnType<typeof setTimeout> | null = null;

    const setPillVisible = (visible: boolean) => {
        dom.annotationNav.classList.toggle('faded-in', visible);
        dom.annotationNav.classList.toggle('faded-out', !visible);
    };

    const updateFade = () => {
        if (!state.loaded) return;
        if (pillTimer) {
            clearTimeout(pillTimer);
            pillTimer = null;
        }
        if (!state.heroStill) {
            setPillVisible(false);
            return;
        }
        pillTimer = setTimeout(() => {
            pillTimer = null;
            if (state.heroStill) setPillVisible(true);
        }, PILL_SETTLE_MS);
    };

    const goTo = (index: number) => {
        currentIndex = index;
        updateDisplay();
        events.fire('annotation.navigate', annotations[currentIndex]);
    };

    // Prev / Next. The very first tap enters the list at its start (or end),
    // instead of skipping past the first highlight from the phantom index 0.
    dom.annotationPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = engaged ? (currentIndex - 1 + annotations.length) % annotations.length : annotations.length - 1;
        engaged = true;
        goTo(target);
    });

    dom.annotationNext.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = engaged ? (currentIndex + 1) % annotations.length : 0;
        engaged = true;
        goTo(target);
    });

    // Sync when an annotation is activated externally (e.g. hotspot click)
    events.on('annotation.activate', (annotation: Annotation) => {
        const idx = annotations.indexOf(annotation);
        if (idx !== -1) {
            engaged = true;
            currentIndex = idx;
            updateDisplay();
        }
    });

    // React to state changes
    events.on('loaded:changed', () => {
        updateMode();
        updateFade();
    });
    events.on('inputMode:changed', updateMode);
    events.on('heroStill:changed', updateFade);

    // Initial state
    updateDisplay();
};

// update the poster image to start blurry and then resolve to sharp during loading
const initPoster = (events: EventHandler) => {
    const poster = document.getElementById('poster');

    events.on('loaded:changed', () => {
        poster.style.display = 'none';
        document.documentElement.style.setProperty('--canvas-opacity', '1');
    });

    const blur = (progress: number) => {
        poster.style.filter = `blur(${Math.floor((100 - progress) * 0.4)}px)`;
    };

    events.on('progress:changed', blur);
};

const initUI = (global: Global) => {
    const { config, events, state } = global;

    // Acquire Elements
    const docRoot = document.documentElement;
    const dom = [
        'ui',
        'controlsWrap',
        'enterFullscreen', 'exitFullscreen',
        'info', 'infoPanel', 'desktopTab', 'touchTab', 'desktopInfoPanel', 'touchInfoPanel',
        'timelineContainer', 'handle', 'time',
        'buttonContainer',
        'play', 'pause',
        'settings', 'settingsPanel',
        'orbitCamera', 'flyCamera', 'fpsCamera',
        'performanceModeRow', 'performanceModeCheck', 'performanceModeOption',
        'gamingControlsDivider', 'gamingControlsRow', 'gamingControlsCheck', 'gamingControlsOption',
        'desktopFlyClickToFly', 'desktopFlyGamingControls', 'desktopClickToWalk', 'desktopGamingControls',
        'touchFlyClickToWalk', 'touchFlyGamingControls',
        'touchClickToWalk', 'touchGamingControls',
        'walkHint',
        'peripheralVignette',
        'reset', 'frame',
        'loadingText', 'loadingBar',
        'joystickBase', 'joystick',
        'showCollision', 'desktopShowCollisionHelp',
        'tooltip',
        'annotationNav', 'annotationPrev', 'annotationNext', 'annotationInfo', 'annotationNavTitle',
        'viewerBranding', 'viewerTitle', 'appVersionLabel'
    ].reduce((acc: Record<string, HTMLElement>, id) => {
        acc[id] = document.getElementById(id);
        return acc;
    }, {});

    // populate the info-panel title with the app version
    dom.appVersionLabel.textContent = appVersion;

    // Remove focus from buttons after click so keyboard input isn't captured by the UI
    dom.ui.addEventListener('click', () => {
        (document.activeElement as HTMLElement)?.blur();
    });

    // Forward wheel events from UI overlays to the canvas so the camera zooms
    // instead of the page scrolling (e.g. annotation nav, tooltips, hotspots).
    // The non-standard wheelDelta{X,Y} properties aren't part of WheelEventInit,
    // so they get dropped by `new WheelEvent(type, init)`. We re-attach them so
    // the trackpad-vs-mouse classifier in input-controller.ts behaves the same
    // whether the event originated on the canvas or was forwarded from the UI.
    const canvas = global.app.graphicsDevice.canvas as HTMLCanvasElement;
    dom.ui.addEventListener('wheel', (event: WheelEvent) => {
        event.preventDefault();
        const forwarded = new WheelEvent(event.type, event);
        const src = event as WheelEvent & {
            wheelDelta?: number, wheelDeltaX?: number, wheelDeltaY?: number
        };
        for (const key of ['wheelDelta', 'wheelDeltaX', 'wheelDeltaY'] as const) {
            if (typeof src[key] === 'number') {
                Object.defineProperty(forwarded, key, { value: src[key], configurable: true });
            }
        }
        canvas.dispatchEvent(forwarded);
    }, { passive: false });

    // Handle loading progress updates
    events.on('progress:changed', (progress) => {
        dom.loadingText.textContent = `${progress}%`;
        if (progress < 100) {
            dom.loadingBar.style.backgroundImage = `linear-gradient(90deg, #F60 0%, #F60 ${progress}%, white ${progress}%, white 100%)`;
        } else {
            dom.loadingBar.style.backgroundImage = 'linear-gradient(90deg, #F60 0%, #F60 100%)';
        }
    });

    // Hide loading bar once loaded
    events.on('loaded:changed', () => {
        document.getElementById('loadingWrap').classList.add('hidden');
    });

    // Fullscreen support
    const hasFullscreenAPI = docRoot.requestFullscreen && document.exitFullscreen;

    const requestFullscreen = () => {
        if (hasFullscreenAPI) {
            docRoot.requestFullscreen();
        } else {
            window.parent.postMessage('requestFullscreen', '*');
            state.isFullscreen = true;
        }
    };

    const exitFullscreen = () => {
        if (hasFullscreenAPI) {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        } else {
            window.parent.postMessage('exitFullscreen', '*');
            state.isFullscreen = false;
        }
    };

    if (hasFullscreenAPI) {
        document.addEventListener('fullscreenchange', () => {
            state.isFullscreen = !!document.fullscreenElement;
        });
    }

    dom.enterFullscreen.addEventListener('click', requestFullscreen);
    dom.exitFullscreen.addEventListener('click', exitFullscreen);

    // toggle fullscreen when user switches between landscape portrait
    // orientation
    screen?.orientation?.addEventListener('change', (event) => {
        if (['landscape-primary', 'landscape-secondary'].includes(screen.orientation.type)) {
            requestFullscreen();
        } else {
            exitFullscreen();
        }
    });

    // update UI when fullscreen state changes
    events.on('isFullscreen:changed', (value) => {
        dom.enterFullscreen.classList[value ? 'add' : 'remove']('hidden');
        dom.exitFullscreen.classList[value ? 'remove' : 'add']('hidden');
    });

    // Performance mode toggle
    dom.performanceModeRow.addEventListener('click', () => {
        state.performanceMode = !state.performanceMode;
    });

    const updatePerformanceMode = () => {
        dom.performanceModeCheck.classList.toggle('active', state.performanceMode);
        localStorage.setItem('performanceMode', String(state.performanceMode));
    };
    events.on('performanceMode:changed', updatePerformanceMode);
    updatePerformanceMode();

    // Gaming mode toggle (settings row visible on mobile only)
    dom.gamingControlsRow.addEventListener('click', () => {
        state.gamingControls = !state.gamingControls;
    });

    const updateGamingSettingsVisibility = () => {
        const isDesktop = state.inputMode === 'desktop';
        dom.gamingControlsDivider.classList.toggle('hidden', isDesktop);
        dom.gamingControlsRow.classList.toggle('hidden', isDesktop);
    };
    events.on('inputMode:changed', updateGamingSettingsVisibility);
    updateGamingSettingsVisibility();

    const updateGamingControls = () => {
        dom.gamingControlsCheck.classList.toggle('active', state.gamingControls);
        dom.desktopFlyClickToFly.classList.toggle('hidden', state.gamingControls);
        dom.desktopFlyGamingControls.classList.toggle('hidden', !state.gamingControls);
        dom.desktopClickToWalk.classList.toggle('hidden', state.gamingControls);
        dom.desktopGamingControls.classList.toggle('hidden', !state.gamingControls);
        dom.touchFlyClickToWalk.classList.toggle('hidden', state.gamingControls);
        dom.touchFlyGamingControls.classList.toggle('hidden', !state.gamingControls);
        dom.touchClickToWalk.classList.toggle('hidden', state.gamingControls);
        dom.touchGamingControls.classList.toggle('hidden', !state.gamingControls);
        localStorage.setItem('gamingControls', String(state.gamingControls));
    };

    events.on('gamingControls:changed', updateGamingControls);
    events.on('inputMode:changed', updateGamingControls);
    updateGamingControls();
    // AR/VR was removed: a link-delivered real-estate walkthrough has no use
    // for headset VR or table-top AR, and the WebGPU->WebGL reload prompt it
    // needed only confused visitors. (See xr.ts deletion; the arMode/vrMode
    // buttons and #xrModal are gone from index.html.)

    // Info panel
    const updateInfoTab = (tab: 'desktop' | 'touch') => {
        if (tab === 'desktop') {
            dom.desktopTab.classList.add('active');
            dom.touchTab.classList.remove('active');
            dom.desktopInfoPanel.classList.remove('hidden');
            dom.touchInfoPanel.classList.add('hidden');
        } else {
            dom.desktopTab.classList.remove('active');
            dom.touchTab.classList.add('active');
            dom.desktopInfoPanel.classList.add('hidden');
            dom.touchInfoPanel.classList.remove('hidden');
        }
    };

    dom.desktopTab.addEventListener('click', () => {
        updateInfoTab('desktop');
    });

    dom.touchTab.addEventListener('click', () => {
        updateInfoTab('touch');
    });

    const toggleHelp = () => {
        updateInfoTab(state.inputMode);
        dom.infoPanel.classList.toggle('hidden');
    };

    dom.info.addEventListener('click', toggleHelp);

    dom.infoPanel.addEventListener('pointerdown', () => {
        dom.infoPanel.classList.add('hidden');
    });

    events.on('inputEvent', (event) => {
        if (event === 'toggleHelp') {
            toggleHelp();
        } else if (event === 'cancel') {
            // close info panel on cancel
            dom.infoPanel.classList.add('hidden');
            dom.settingsPanel.classList.add('hidden');

            // close fullscreen on cancel
            if (state.isFullscreen) {
                exitFullscreen();
            }
        } else if (event === 'interrupt') {
            dom.settingsPanel.classList.add('hidden');
        }
    });

    // fade ui controls after 5 seconds of inactivity
    events.on('controlsHidden:changed', (value) => {
        dom.controlsWrap.classList.toggle('faded-out', value);
        dom.controlsWrap.classList.toggle('faded-in', !value);
    });

    // show the ui and start a timer to hide it again
    let uiTimeout: ReturnType<typeof setTimeout> | null = null;
    let annotationVisible = false;

    const isPointerCapturedMode = () => (
        state.inputMode === 'desktop' &&
        state.gamingControls &&
        (state.cameraMode === 'walk' || state.cameraMode === 'fly')
    );

    const hideUI = () => {
        if (uiTimeout) {
            clearTimeout(uiTimeout);
            uiTimeout = null;
        }
        dom.infoPanel.classList.add('hidden');
        dom.settingsPanel.classList.add('hidden');
        dom.walkHint.classList.add('hidden');
        state.controlsHidden = true;
    };

    const showUI = () => {
        if (isPointerCapturedMode()) {
            hideUI();
            return;
        }
        if (uiTimeout) {
            clearTimeout(uiTimeout);
        }
        state.controlsHidden = false;
        uiTimeout = setTimeout(() => {
            uiTimeout = null;
            if (!annotationVisible) {
                state.controlsHidden = true;
            }
        }, 4000);
    };

    // Show controls once loaded
    events.on('loaded:changed', () => {
        dom.controlsWrap.classList.remove('hidden');
        showUI();
    });

    events.on('inputEvent', showUI);

    const updateCapturedUI = () => {
        if (isPointerCapturedMode()) {
            hideUI();
        } else {
            showUI();
        }
    };

    events.on('cameraMode:changed', updateCapturedUI);
    events.on('inputMode:changed', updateCapturedUI);
    events.on('gamingControls:changed', updateCapturedUI);

    // keep UI visible while an annotation tooltip is shown
    events.on('annotation.activate', () => {
        annotationVisible = true;
        showUI();
    });

    events.on('annotation.deactivate', () => {
        annotationVisible = false;
        showUI();
    });

    // Animation controls. Wire the play/pause/timeline UI exactly ONCE on the
    // first hasAnimation:changed — this block registers click/scrub/pointer
    // listeners, so a second firing (e.g. a future settings reload) would
    // duplicate every handler and double-fire scrubs.
    let animationUiWired = false;
    events.on('hasAnimation:changed', () => {
        if (animationUiWired) return;
        animationUiWired = true;

        // Start and Stop animation
        dom.play.addEventListener('click', () => {
            state.cameraMode = 'anim';
            state.animationPaused = false;
        });

        dom.pause.addEventListener('click', () => {
            state.cameraMode = 'anim';
            state.animationPaused = true;
        });

        const updatePlayPause = () => {
            if (state.cameraMode !== 'anim' || state.animationPaused) {
                dom.play.classList.remove('hidden');
                dom.pause.classList.add('hidden');
            } else {
                dom.play.classList.add('hidden');
                dom.pause.classList.remove('hidden');
            }

            if (state.cameraMode === 'anim') {
                dom.timelineContainer.classList.remove('hidden');
            } else {
                dom.timelineContainer.classList.add('hidden');
            }
        };

        // Update UI on animation changes
        events.on('cameraMode:changed', updatePlayPause);
        events.on('animationPaused:changed', updatePlayPause);

        const updateSlider = () => {
            dom.handle.style.left = `${state.animationTime / state.animationDuration * 100}%`;
            dom.time.style.left = `${state.animationTime / state.animationDuration * 100}%`;
            dom.time.innerText = `${state.animationTime.toFixed(1)}s`;
        };

        events.on('animationTime:changed', updateSlider);
        events.on('animationLength:changed', updateSlider);

        const handleScrub = (event: PointerEvent) => {
            const rect = dom.timelineContainer.getBoundingClientRect();
            const t = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left)) / rect.width;
            events.fire('scrubAnim', state.animationDuration * t);
            showUI();
        };

        let paused = false;
        let captured = false;

        dom.timelineContainer.addEventListener('pointerdown', (event: PointerEvent) => {
            if (!captured) {
                handleScrub(event);
                dom.timelineContainer.setPointerCapture(event.pointerId);
                dom.time.classList.remove('hidden');
                paused = state.animationPaused;
                state.animationPaused = true;
                captured = true;
            }
        });

        dom.timelineContainer.addEventListener('pointermove', (event: PointerEvent) => {
            if (captured) {
                handleScrub(event);
            }
        });

        dom.timelineContainer.addEventListener('pointerup', (event) => {
            if (captured) {
                dom.timelineContainer.releasePointerCapture(event.pointerId);
                dom.time.classList.add('hidden');
                state.animationPaused = paused;
                captured = false;
            }
        });
    });

    // Camera mode UI
    const updateCameraModeUI = () => {
        dom.orbitCamera.classList.toggle('active', state.cameraMode === 'orbit');
        dom.flyCamera.classList.toggle('active', state.cameraMode === 'fly');
        dom.fpsCamera.classList.toggle('active', state.cameraMode === 'walk');
        // peripheral-vision overlay is a walk-mode-only "human walkthrough" cue
        dom.peripheralVignette.classList.toggle('visible', state.cameraMode === 'walk');
    };

    events.on('cameraMode:changed', updateCameraModeUI);
    // sync once for the initial mode (the scene may start directly in walk,
    // whose mode-set can fire before this listener is attached)
    updateCameraModeUI();

    // Walk mode hint banner (shown once per session on first FPS entry)
    let walkHintShown = false;

    const getWalkHintText = () => {
        if (state.inputMode === 'desktop') {
            return localize('walk-hint.desktop');
        }
        return localize(state.gamingControls ? 'walk-hint.touch-gaming' : 'walk-hint.touch-tap');
    };

    events.on('cameraMode:changed', (value: string) => {
        if (value === 'walk' && !walkHintShown && !isPointerCapturedMode()) {
            walkHintShown = true;
            dom.walkHint.textContent = getWalkHintText();
            dom.walkHint.classList.remove('hidden');
        } else if (value !== 'walk') {
            dom.walkHint.classList.add('hidden');
        }
    });

    const dismissWalkHint = () => dom.walkHint.classList.add('hidden');

    dom.walkHint.addEventListener('click', dismissWalkHint);
    events.on('inputEvent', (type: string) => {
        if (type === 'interrupt') dismissWalkHint();
    });

    // show/hide the FPS button based on whether walk mode is offered
    // (collision data exists AND scene is large enough to walk around in)
    events.on('walkAllowed:changed', (value: boolean) => {
        dom.fpsCamera.classList.toggle('hidden', !value);
        // adjust fly button shape: middle when FPS is visible, right when hidden
        dom.flyCamera.classList.toggle('middle', value);
        dom.flyCamera.classList.toggle('right', !value);
    });

    // Collision overlay toggle + matching help-panel row (only visible when overlay is available)
    events.on('hasCollisionOverlay:changed', (value: boolean) => {
        dom.showCollision.classList.toggle('hidden', !value);
        dom.desktopShowCollisionHelp.classList.toggle('hidden', !value);
    });

    dom.showCollision.addEventListener('click', () => {
        state.collisionOverlayEnabled = !state.collisionOverlayEnabled;
    });

    events.on('collisionOverlayEnabled:changed', (value: boolean) => {
        dom.showCollision.classList.toggle('active', value);
    });

    dom.settings.addEventListener('click', () => {
        dom.settingsPanel.classList.toggle('hidden');
    });

    dom.orbitCamera.addEventListener('click', () => {
        state.cameraMode = 'orbit';
    });

    dom.flyCamera.addEventListener('click', () => {
        state.cameraMode = 'fly';
    });

    dom.fpsCamera.addEventListener('click', () => {
        events.fire('inputEvent', 'toggleWalk');
    });

    dom.reset.addEventListener('click', (event) => {
        events.fire('inputEvent', 'reset', event);
    });

    dom.frame.addEventListener('click', (event) => {
        events.fire('inputEvent', 'frame', event);
    });

    // Initialize touch joystick for fly mode
    initJoystick(dom, events, state);

    // Initialize annotation navigator
    initAnnotationNav(dom, events, state, global.settings.annotations);

    // Hide all UI (poster, loading bar, controls)
    if (config.noui) {
        dom.ui.classList.add('hidden');
    }

    // tooltips
    const tooltip = new Tooltip(dom.tooltip);

    tooltip.register(dom.play, localize('tooltip.play'), 'top');
    tooltip.register(dom.pause, localize('tooltip.pause'), 'top');
    tooltip.register(dom.orbitCamera, localize('tooltip.orbit-camera'), 'top');
    tooltip.register(dom.flyCamera, localize('tooltip.fly-camera'), 'top');
    tooltip.register(dom.fpsCamera, localize('tooltip.walk-mode'), 'top');
    tooltip.register(dom.reset, localize('tooltip.reset-camera'), 'bottom');
    tooltip.register(dom.frame, localize('tooltip.frame-scene'), 'bottom');
    tooltip.register(dom.showCollision, localize('tooltip.show-collision'), 'top');
    tooltip.register(dom.settings, localize('tooltip.settings'), 'top');
    tooltip.register(dom.info, localize('tooltip.help'), 'top');
    tooltip.register(dom.enterFullscreen, localize('tooltip.fullscreen'), 'top');
    tooltip.register(dom.exitFullscreen, localize('tooltip.fullscreen'), 'top');

    // White-label: this is our own fork, so we never reveal the upstream
    // SuperSplat attribution badge — not even when embedded cross-origin.
    // (Stock SuperSplat un-hides #viewerBranding for third-party embeds here;
    // its isThirdPartyEmbedded helper was removed with that behavior.)
};

export { initPoster, initUI };
