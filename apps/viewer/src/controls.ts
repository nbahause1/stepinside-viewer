import type { Global } from './types';

// Bottom control dome. Two rows that swap with the camera mode:
//   walk mode   : reset · measure · enter bird's-eye (drone)
//   bird's-eye  : previous view (‹) · return to walking · next view (›)
const initControls = (global: Global) => {
    const { events, settings } = global;

    const dome = document.getElementById('controlDome');
    if (!dome) return;

    const tour = document.getElementById('domeTour');
    const reset = document.getElementById('domeReset');
    const measure = document.getElementById('domeMeasure');
    const aerial = document.getElementById('domeAerial');
    const aerialExit = document.getElementById('domeAerialExit');
    const prev = document.getElementById('domePrev');
    const next = document.getElementById('domeNext');

    reset?.addEventListener('click', (event) => {
        events.fire('inputEvent', 'reset', event);
    });

    // Guided tour ("Rundgang"): only offered when the scene ships an authored
    // camera track that doesn't already autoplay (startMode 'animTrack' keeps
    // its own start experience). The button toggles anim mode in the camera
    // manager; any camera input during the tour also stops it.
    if (tour && settings.animTracks?.length > 0 && settings.startMode !== 'animTrack') {
        tour.classList.remove('hidden');
        tour.addEventListener('click', () => events.fire('inputEvent', 'tour'));
        events.on('cameraMode:changed', (mode: string) => {
            const touring = mode === 'anim';
            tour.classList.toggle('active', touring);
            const label = touring ? 'Rundgang beenden' : 'Rundgang starten';
            tour.setAttribute('aria-label', label);
            tour.title = label;
        });
    }

    // entering (drone button) and leaving (walk button) both toggle aerial mode
    aerial?.addEventListener('click', () => events.fire('inputEvent', 'aerial'));
    aerialExit?.addEventListener('click', () => events.fire('inputEvent', 'aerial'));

    // page through the curated bird's-eye viewpoints
    prev?.addEventListener('click', () => events.fire('inputEvent', 'aerialPrev'));
    next?.addEventListener('click', () => events.fire('inputEvent', 'aerialNext'));

    // swap the whole bottom bar with the mode (walk controls <-> view paging)
    events.on('cameraMode:changed', (mode: string) => {
        dome.classList.toggle('is-aerial', mode === 'aerial');
    });

    // Measurement tool: toggles measure mode (handled in measure.ts, which also
    // sets body.measure-active — the button then shows a walk figure to signal
    // "press again to return to walking").
    measure?.addEventListener('click', () => {
        events.fire('inputEvent', 'measure');
    });
};

export { initControls };
