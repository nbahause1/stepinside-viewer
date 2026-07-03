import type { Global } from './types';

// Subtle zoom badge ("1,6×"): appears bottom-centre while the optical zoom is
// active, fades away when the view returns to 1×. Display-only — it never
// takes pointer events, so it can't interfere with the camera or the cards.

const initZoomIndicator = (global: Global) => {
    const { events } = global;

    let badge: HTMLDivElement | null = null;
    let hideTimer = 0;

    const ensure = () => {
        if (badge) return badge;
        badge = document.createElement('div');
        badge.id = 'zoomBadge';
        badge.setAttribute('aria-hidden', 'true');
        (document.getElementById('ui') ?? document.body).appendChild(badge);
        return badge;
    };

    events.on('zoom:changed', (zoom: number) => {
        const el = ensure();
        window.clearTimeout(hideTimer);
        if (zoom > 1.001) {
            // German decimal comma, one digit — reads like a camera app
            el.textContent = `${zoom.toFixed(1).replace('.', ',')}×`;
            el.classList.add('visible');
        } else {
            // brief "1,0×" so zooming back out lands with feedback, then fade
            el.textContent = '1,0×';
            hideTimer = window.setTimeout(() => el?.classList.remove('visible'), 700);
        }
    });
};

export { initZoomIndicator };
