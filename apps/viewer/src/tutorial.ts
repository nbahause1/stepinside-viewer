import type { Vec3 } from 'playcanvas';

import type { Global } from './types';

// Guided onboarding shown on first entry into walk mode. A chain of gated,
// glowing glass cards, each pointing at the control it teaches:
//   1. look       — drag to sweep the view ~LOOK_EACH_SIDE_DEG° to BOTH sides
//                   (click-to-walk is blocked until done).
//   2. walk       — click a spot and travel at least WALK_DISTANCE metres.
//   3. drone      — after exploring a little (a few arrivals or a timeout) the
//                   bird's-eye button glows; a card explains it.
//   4. arrows     — in bird's-eye, the ‹ › view buttons glow ("other angles").
//   5. arrowsBack — after paging a couple of views, the walk-figure button glows
//                   ("press it to walk again").
//   6. measure    — back in walk mode, the measure button glows.
//   7. measuring  — after entering measure mode, place TWO points to measure;
//                   only a finished measurement advances the chain.
//   8. home       — finally the home button glows ("get back to the start").
// The active card gently pulses so it's clear an action is expected.

// How far (degrees) the view must sweep to each side before "look" completes.
// Kept gentle on purpose: a slight turn each way is enough to learn the gesture.
const LOOK_EACH_SIDE_DEG = 10;
// How far (metres) the camera must travel before "walk" completes.
const WALK_DISTANCE = 0.6;
// After the basic steps, hint the bird's-eye once the visitor has explored a
// little. The walk-tutorial click itself triggers the walk→explore switch while
// still in the 'walk' phase, so it is NOT counted — meaning one further click in
// 'explore' (the visitor's "second" click overall) shows the drone. A time
// fallback covers the case where they just stand and look around.
const DRONE_HINT_AFTER_MOVES = 1;
const DRONE_HINT_AFTER_MS = 12000;
// How many view-arrow presses before pointing at the "walk again" button.
const ARROW_PRESSES = 2;

// Signed shortest angular difference a - b, wrapped to [-180, 180].
const shortestAngle = (a: number, b: number) => {
    let d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
};

const initTutorial = (global: Global) => {
    const { app, events, state, camera } = global;

    const root = document.getElementById('tutorial');
    const cardEls = {
        look: document.getElementById('tutorialLook'),
        walk: document.getElementById('tutorialWalk'),
        drone: document.getElementById('tutorialDrone'),
        arrows: document.getElementById('tutorialArrows'),
        walkBack: document.getElementById('tutorialWalkBack'),
        measure: document.getElementById('tutorialMeasure'),
        measuring: document.getElementById('tutorialMeasuring'),
        home: document.getElementById('tutorialHome'),
        chat: document.getElementById('tutorialChat')
    };
    if (!root || Object.values(cardEls).some(el => !el)) return;
    const cards = Object.values(cardEls) as HTMLElement[];

    // The concierge chat pill is the final onboarding target (only if present).
    const chatToggle = document.getElementById('chatToggle');
    const chatPill = document.getElementById('chatPill');
    const chatAvailable = () => !!chatPill && !chatPill.classList.contains('hidden');

    // Control-dome buttons the onboarding can point at.
    const domeIds = ['domeReset', 'domeMeasure', 'domeAerial', 'domePrev', 'domeNext', 'domeAerialExit'];

    type Phase =
        'idle' | 'look' | 'walk' | 'explore' | 'drone' |
        'arrows' | 'arrowsBack' | 'measure' | 'measuring' | 'home' | 'chat' | 'done';
    let phase: Phase = 'idle';

    const yaw = () => camera.getEulerAngles().y;

    // look tracking (relative to the yaw at which the step began)
    let startYaw = 0;
    let minRel = 0;
    let maxRel = 0;
    // each gesture is a DRAG in one direction, measured from the furthest point
    // reached the other way — so turning left and then back toward the start
    // already counts as a rightward drag (no need to cross the start both ways).
    let sweptOneWay = false;
    let sweptOtherWay = false;

    // walk tracking
    let walkStart: Vec3 | null = null;

    // explore / arrow tracking
    let moves = 0;
    let droneTimer = 0;
    let arrowPresses = 0;

    // Glow exactly the given dome buttons (clears any previous hint first).
    const hintButtons = (...ids: string[]) => {
        domeIds.forEach(id => document.getElementById(id)?.classList.remove('tutorial-hint'));
        ids.forEach(id => document.getElementById(id)?.classList.add('tutorial-hint'));
    };

    // Show exactly one card and fade the rack in.
    const showCard = (el: HTMLElement) => {
        cards.forEach(c => c.classList.add('hidden'));
        el.classList.remove('hidden');
        root.classList.remove('hidden');
        root.classList.add('visible');
    };

    const beginLook = () => {
        phase = 'look';
        startYaw = yaw();
        minRel = 0;
        maxRel = 0;
        sweptOneWay = false;
        sweptOtherWay = false;
        state.moveLocked = true;        // block click-to-walk until the visitor has looked around
        document.body.classList.add('tutorial-active');
        hintButtons();
        showCard(cardEls.look!);
    };

    const beginWalk = () => {
        phase = 'walk';
        state.moveLocked = false;       // unlock movement so the visitor can walk
        walkStart = camera.getPosition().clone();
        showCard(cardEls.walk!);
    };

    const showDroneHint = () => {
        if (phase !== 'explore') return;
        phase = 'drone';
        window.clearTimeout(droneTimer);
        hintButtons('domeAerial');
        showCard(cardEls.drone!);
    };

    // After the walk step: fade the cards away, let the visitor explore freely,
    // and arm the bird's-eye hint (on a few arrivals or a timeout).
    const beginExplore = () => {
        phase = 'explore';
        state.moveLocked = false;
        moves = 0;
        root.classList.remove('visible');       // fade out; root stays mounted (opacity 0)
        droneTimer = window.setTimeout(showDroneHint, DRONE_HINT_AFTER_MS);
    };

    // In bird's-eye: point at the ‹ › view buttons.
    const beginArrows = () => {
        phase = 'arrows';
        arrowPresses = 0;
        window.clearTimeout(droneTimer);
        hintButtons('domePrev', 'domeNext');
        showCard(cardEls.arrows!);
    };

    // After paging a couple of views: point at the walk-figure return button.
    const beginArrowsBack = () => {
        phase = 'arrowsBack';
        hintButtons('domeAerialExit');
        showCard(cardEls.walkBack!);
    };

    // Back in walk mode: point at the measure button.
    const beginMeasureHint = () => {
        phase = 'measure';
        hintButtons('domeMeasure');
        showCard(cardEls.measure!);
    };

    // In measure mode: ask for two points (the action is on the scene, not a
    // button), and wait for a finished measurement before advancing.
    const beginMeasuring = () => {
        phase = 'measuring';
        hintButtons();
        showCard(cardEls.measuring!);
    };

    // Last step: point at the home button.
    const beginHomeHint = () => {
        phase = 'home';
        hintButtons('domeReset');
        showCard(cardEls.home!);
    };

    // ---- Post-onboarding feature hints (NOT part of the linear tutorial) ----
    // The tutorial teaches navigation only. The feature buttons reveal themselves
    // afterwards: the "Möbliert sehen" sofa gently breathes until it is tapped;
    // the concierge gets its own glow later, with a gap, so the two never compete.
    const stageTrigger = document.getElementById('stageTrigger');
    const SOFA_HINT_AFTER_TUTORIAL_MS = 10000;
    const CONCIERGE_HINT_AFTER_SOFA_MS = 54000;
    let sofaEngaged = false;
    let conciergeHinted = false;

    const startSofaHint = () => {
        if (!sofaEngaged) stageTrigger?.classList.add('attention');
    };
    const startConciergeHint = () => {
        if (conciergeHinted || !chatAvailable()) return;
        conciergeHinted = true;
        chatToggle?.classList.add('tutorial-hint');
    };
    // Kicked off when the tutorial finishes: glow the sofa shortly after.
    const startFeatureHints = () => {
        window.setTimeout(startSofaHint, SOFA_HINT_AFTER_TUTORIAL_MS);
    };

    // Onboarding complete: clear the hint and dismiss the cards.
    const finishAll = () => {
        phase = 'done';
        state.moveLocked = false;
        window.clearTimeout(droneTimer);
        hintButtons();
        chatToggle?.classList.remove('tutorial-hint');
        root.classList.remove('visible');
        window.setTimeout(() => {
            root.classList.add('hidden');
            document.body.classList.remove('tutorial-active');
        }, 450);
        // hand off to the post-onboarding feature hints (sofa, then concierge)
        startFeatureHints();
    };

    app.on('update', () => {
        if (phase === 'look') {
            const rel = shortestAngle(yaw(), startYaw);
            if (rel < minRel) minRel = rel;
            if (rel > maxRel) maxRel = rel;
            // a drag away from the furthest point reached the other way counts:
            // turning back toward the start after looking one way satisfies the
            // opposite direction (no need to overshoot the start on both sides).
            if (maxRel - rel >= LOOK_EACH_SIDE_DEG) sweptOneWay = true;
            if (rel - minRel >= LOOK_EACH_SIDE_DEG) sweptOtherWay = true;
            if (sweptOneWay && sweptOtherWay) {
                beginWalk();
            }
        } else if (phase === 'walk' && walkStart) {
            if (camera.getPosition().distance(walkStart) >= WALK_DISTANCE) {
                beginExplore();
            }
        }
    });

    // Each click-to-walk (fired the moment the visitor picks a spot — reliable,
    // unlike arrival) counts as exploring; hint the drone after a couple.
    events.on('navigateTo', () => {
        if (phase === 'explore') {
            moves += 1;
            if (moves >= DRONE_HINT_AFTER_MOVES) showDroneHint();
        }
    });

    // Camera mode drives the bird's-eye legs: entering aerial shows the arrow
    // hint; returning to walk (from either bird's-eye card) advances to measure.
    events.on('cameraMode:changed', (mode: string) => {
        if (mode === 'aerial') {
            if (phase === 'explore' || phase === 'drone') beginArrows();
        } else if (phase === 'arrows' || phase === 'arrowsBack') {
            beginMeasureHint();
        }
    });

    // Button presses advance the remaining legs.
    events.on('inputEvent', (name: string) => {
        if ((name === 'aerialNext' || name === 'aerialPrev') && phase === 'arrows') {
            arrowPresses += 1;
            if (arrowPresses >= ARROW_PRESSES) beginArrowsBack();
        } else if (name === 'reset' && phase === 'home') {
            // Home pressed → back at the start: the linear tutorial is done. The
            // feature hints (sofa, then concierge) take over from here.
            finishAll();
        }
    });

    // Engaging the sofa stops its glow and, after a gap, invites the concierge
    // (so the two hints never glow at the same time).
    stageTrigger?.addEventListener('click', () => {
        sofaEngaged = true;
        stageTrigger.classList.remove('attention');
        window.setTimeout(startConciergeHint, CONCIERGE_HINT_AFTER_SOFA_MS);
    });

    // Opening the concierge clears its glow.
    events.on('chatOpen:changed', (open: boolean) => {
        if (open) chatToggle?.classList.remove('tutorial-hint');
    });

    // Measure leg: entering measure mode asks for two points; a finished
    // measurement advances to the home hint. Leaving measure mode before
    // finishing reverts to the "press measure" hint.
    events.on('measureActive', (on: boolean) => {
        if (on && phase === 'measure') {
            beginMeasuring();
        } else if (!on && phase === 'measuring') {
            beginMeasureHint();
        }
    });
    events.on('measureComplete', () => {
        if (phase === 'measuring') beginHomeHint();
    });

    // Start once the scene is ready and we are in walk mode (the default
    // first-person mode for walkable interiors).
    const maybeStart = () => {
        if (phase !== 'idle') return;
        if (state.loaded && state.cameraMode === 'walk') {
            beginLook();
        }
    };

    events.on('loaded:changed', maybeStart);
    maybeStart();
};

export { initTutorial };
