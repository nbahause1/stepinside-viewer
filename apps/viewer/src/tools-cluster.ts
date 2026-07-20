import type { Global } from './types';

// The bottom-left corner rests as ONE bubble. Tapping it fans the concierge,
// the neighbourhood map and share upwards; tapping it again — or anywhere
// outside the cluster — folds them back. Everything visual lives in index.scss
// under `body.tools-open`; this module only owns the flag and the dismiss
// rules, so the motion stays in one place.
const TOOL_PILL_IDS = ['chatPill', 'surroundingsPill', 'sharePill'];

const initToolsCluster = (global: Global) => {
    const { events } = global;

    const anchor = document.getElementById('toolsAnchor');
    const toggle = document.getElementById('toolsToggle');
    if (!anchor || !toggle) return;

    const toolPills = () => TOOL_PILL_IDS
        .map(id => document.getElementById(id))
        .filter((el): el is HTMLElement => !!el);

    let open = false;

    const setOpen = (next: boolean) => {
        if (open === next) return;
        open = next;
        document.body.classList.toggle('tools-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        const label = open ? 'Werkzeuge schließen' : 'Werkzeuge öffnen';
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
    };

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!open);
    });

    // Any press that isn't on the anchor or one of the unfolded tools folds the
    // cluster away — the pills' own shields stop their taps here, so the checks
    // run in the capture phase. A tool's OWN surface counts as inside (the chat
    // panel lives inside #chatPill), otherwise using it would collapse it.
    document.addEventListener('pointerdown', (e) => {
        if (!open) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (anchor.contains(target)) return;
        if (toolPills().some(p => p.contains(target))) return;
        setOpen(false);
    }, true);

    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape' && open) setOpen(false);
    });

    // Only offer the anchor once at least one tool actually exists. Each module
    // reveals its own pill (concierge/map/share all bail out on a misconfigured
    // build), so without this the button could unfold an empty stack.
    const reveal = () => {
        const any = toolPills().some(p => !p.classList.contains('hidden'));
        anchor.classList.toggle('hidden', !any);
    };
    events.on('loaded:changed', reveal);
    reveal();
};

export { initToolsCluster };
