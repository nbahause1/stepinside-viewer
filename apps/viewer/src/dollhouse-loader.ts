import type { Global } from './types';

// Branded loading cover for the dollhouse ("Puppenhaus") switch. Entering the
// model — and returning to the walk — re-streams the splat LOD for the new
// vantage; on phones that leaves a visibly half-loaded model for a beat. Per
// request the SAME name-fills loader as the boot splash covers the WHOLE
// switch: from the tap until the view is fully streamed, then it reveals into
// the finished view. Reuses the boot splash's `bootLoaderFill` keyframes
// (global, defined in index.html); styling lives under #dhLoader in index.scss.
const initDollhouseLoader = (global: Global) => {
    const { app, events } = global;

    const overlay = document.createElement('div');
    overlay.id = 'dhLoader';
    overlay.setAttribute('aria-hidden', 'true');
    // base (dim) + fill (bright, clip-path wipes L→R) stacked in a relative box
    overlay.innerHTML =
        '<div class="dhLoader__box">' +
        '<div class="dhLoader__mark"><span class="dhLoader__diamond"></span><span>innsyn</span></div>' +
        '<div class="dhLoader__mark dhLoader__fill"><span class="dhLoader__diamond"></span><span>innsyn</span></div>' +
        '</div>';
    document.body.appendChild(overlay);

    const fill = overlay.querySelector('.dhLoader__fill') as HTMLElement;

    let active = false;
    let shownAt = 0;
    let capTimer = 0;
    // Never flash (give the fill a readable beat), but never trap the visitor
    // behind the cover either — reveal on ready, or force it after the cap.
    const MIN_MS = 600;
    const MAX_MS = 5000;

    const reveal = () => {
        if (!active) return;
        active = false;
        clearTimeout(capTimer);
        overlay.classList.add('is-complete'); // snap the fill to 100%
        overlay.classList.add('is-hiding');   // then fade the cover away
        window.setTimeout(() => overlay.classList.remove('is-on', 'is-hiding', 'is-complete'), 420);
        app.renderNextFrame = true;
    };

    const show = () => {
        active = true;
        shownAt = performance.now();
        overlay.classList.remove('is-complete', 'is-hiding');
        // restart the fill from empty each time
        fill.style.animation = 'none';
        void fill.offsetWidth;
        fill.style.animation = '';
        overlay.classList.add('is-on');
        clearTimeout(capTimer);
        capTimer = window.setTimeout(reveal, MAX_MS);
        app.renderNextFrame = true;
    };

    events.on('dollhouse:open', show);
    events.on('dollhouse:close', show);

    // Reveal once the gsplat reports the new view fully streamed (loading back
    // to 0), but not before MIN_MS so it reads as a load, not a blip. The
    // camera transition runs behind the cover, so we land on the finished view.
    const eh = app.systems.gsplat as unknown as {
        on(evt: string, cb: (...args: unknown[]) => void): void;
    };
    eh.on('frame:ready', (...args: unknown[]) => {
        const ready = args[2] as boolean;
        const loading = args[3] as number;
        if (active && ready && loading === 0 && performance.now() - shownAt >= MIN_MS) {
            reveal();
        }
    });
};

export { initDollhouseLoader };
