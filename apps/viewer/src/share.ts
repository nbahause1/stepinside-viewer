import qrcodegen from 'qrcode-generator';

import type { Global } from './types';

// Share + deep-link to a viewpoint.
//
// A viewpoint is encoded into a compact, versioned `?view=` URL parameter:
//
//     v1,px,py,pz,tx,ty,tz,fov[,m]
//
// position (px,py,pz), focus target (tx,ty,tz), field of view and an optional
// single-char camera mode (w/f/o/a). On load, a valid `?view=` is applied once
// the scene is ready (after the staging prewarm detour, if any); anything
// invalid is silently ignored. The actual pose capture/restore lives in
// camera-manager.ts ('view:capture' / 'view:apply'), which reuses the same
// look()/snap() pose logic as the debug panel's camera state restore.
//
// The share button (small glass icon, top-left) builds the current URL with
// the `?view=` param and hands it to the native share sheet where available
// (iOS/Android). Without navigator.share (desktop) it copies the link to the
// clipboard ("Link kopiert" toast) and opens a small glass popover with a QR
// code ("Auf dem Handy öffnen").

// Pose passed between share.ts and camera-manager.ts via the
// 'view:capture' / 'view:apply' events.
type SharedView = {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    mode?: string;      // 'w' walk | 'f' fly | 'o' orbit | 'a' aerial
};

const VIEW_VERSION = 'v1';
const VIEW_MODE_CHARS = ['w', 'f', 'o', 'a'];

// keep shared links tidy: centimetre precision is plenty for a room
const round2 = (n: number) => String(Math.round(n * 100) / 100);

const encodeView = (view: SharedView): string => {
    const parts = [
        VIEW_VERSION,
        ...view.position.map(round2),
        ...view.target.map(round2),
        String(Math.round(view.fov))
    ];
    if (view.mode && VIEW_MODE_CHARS.includes(view.mode)) {
        parts.push(view.mode);
    }
    return parts.join(',');
};

// Strict parse of the `?view=` value; returns null on ANY irregularity so a
// tampered or truncated link degrades to the normal start pose.
const decodeView = (raw: string | null): SharedView | null => {
    if (!raw) return null;
    const parts = raw.split(',');
    if (parts[0] !== VIEW_VERSION || parts.length < 8 || parts.length > 9) return null;

    const nums = parts.slice(1, 8).map(Number);
    // finite, and within a sane world envelope (scans are room/building sized)
    if (nums.some(n => !Number.isFinite(n) || Math.abs(n) > 1e5)) return null;

    const position: [number, number, number] = [nums[0], nums[1], nums[2]];
    const target: [number, number, number] = [nums[3], nums[4], nums[5]];
    const fov = nums[6];
    if (fov < 5 || fov > 170) return null;

    // degenerate pose: position and target must not coincide (no view direction)
    const dx = target[0] - position[0];
    const dy = target[1] - position[1];
    const dz = target[2] - position[2];
    if (dx * dx + dy * dy + dz * dz < 1e-6) return null;

    const mode = parts[8];
    if (mode !== undefined && !VIEW_MODE_CHARS.includes(mode)) return null;

    return { position, target, fov, mode };
};

const initShare = (global: Global) => {
    const { events, state } = global;

    // ---- (a) deep link: apply a valid ?view= once the scene is ready --------
    const linkedView = decodeView(new URLSearchParams(location.search).get('view'));
    if (linkedView) {
        // Wait for the first rendered frame AND the end of the staging prewarm
        // (its silent drone detour restores the start pose when it finishes,
        // which would overwrite the deep-linked one). initShare is called
        // before initTutorial, so on the same events the pose lands before the
        // onboarding samples its starting yaw.
        let applied = false;
        const maybeApply = () => {
            if (applied || !state.loaded || state.prewarming) return;
            applied = true;
            events.fire('view:apply', linkedView);
        };
        events.on('loaded:changed', maybeApply);
        events.on('prewarming:changed', maybeApply);
        maybeApply();
    }

    // ---- (b)+(c) share button, toast, QR popover ----------------------------
    const pill = document.getElementById('sharePill');
    const trigger = document.getElementById('shareTrigger');
    const popover = document.getElementById('sharePopover');
    const qrHolder = document.getElementById('shareQr');
    const toast = document.getElementById('shareToast');
    if (!pill || !trigger || !popover || !qrHolder || !toast) return;

    // reveal alongside the rest of the chrome
    events.on('loaded:changed', () => pill.classList.remove('hidden'));

    const buildShareUrl = (): string | null => {
        const out: { view?: SharedView } = {};
        events.fire('view:capture', out);
        if (!out.view) return null;
        const url = new URL(location.href);
        url.searchParams.set('view', encodeView(out.view));
        // commas are legal query characters — undo the %2C escaping so the
        // link stays compact and human-readable
        return url.toString().replace(/%2C/gi, ',');
    };

    let toastTimer = 0;
    const showToast = () => {
        toast.classList.add('visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
    };

    let renderedQrUrl = '';
    const renderQr = (url: string) => {
        if (url === renderedQrUrl) return;
        renderedQrUrl = url;
        const qr = qrcodegen(0, 'M');   // type 0 = auto-size to the data
        qr.addData(url);
        qr.make();
        qrHolder.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    };

    const closePopover = () => {
        popover.classList.add('hidden');
    };

    const openPopover = (url: string) => {
        renderQr(url);
        popover.classList.remove('hidden');
    };

    // dismiss on any press outside the pill (capture phase so a canvas drag
    // that stops propagation still closes it)
    document.addEventListener('pointerdown', (event) => {
        if (popover.classList.contains('hidden')) return;
        if (!pill.contains(event.target as Node)) closePopover();
    }, true);

    // dismiss the popover like the other panels: Escape or any interrupt
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePopover();
    });
    events.on('inputEvent', (type: string) => {
        if (type === 'cancel' || type === 'interrupt') closePopover();
    });

    trigger.addEventListener('click', async () => {
        // second tap on the button dismisses an open popover
        if (!popover.classList.contains('hidden')) {
            closePopover();
            return;
        }

        const url = buildShareUrl();
        if (!url) return;

        // anonymous usage signal (no-op unless analytics is configured); the
        // shared URL itself is never sent anywhere
        events.fire('analytics', 'share');

        if (navigator.share) {
            try {
                await navigator.share({ url });
            } catch {
                // visitor dismissed the share sheet — nothing to do
            }
        } else {
            try {
                await navigator.clipboard?.writeText(url);
                showToast();
            } catch {
                // clipboard unavailable (e.g. insecure origin) — the QR still helps
            }
            openPopover(url);
        }
    });
};

export { initShare };
export type { SharedView };
