import type { Annotation } from './settings';
import type { Global } from './types';

// Anonymous usage analytics. When settings.analytics carries an endpoint and a
// propertyId, the viewer batches a small set of interaction events (opens,
// dwell heartbeats, feature usage) to that endpoint so the owner's report can
// answer "wird die Tour genutzt?". Without the config the module is an inert
// no-op — nothing listens, nothing is sent.
//
// PRIVACY IS A FEATURE (mirrors the server in concierge-api/src/analytics.ts):
//   - No cookies, no localStorage, no fingerprinting. The session id is
//     crypto-random, lives in this closure only and dies with the tab — two
//     visits by the same person are two unrelated sessions.
//   - The client sends no IP/user-agent data; the server never stores either.
//   - Free text is only ever what the visitor typed deliberately (concierge
//     questions); everything else is feature names and counters.
//
// Robustness contract: fire-and-forget. Every network call is silently caught,
// offline batches are held (capped) and retried, and the whole init is wrapped
// so analytics can NEVER throw into — or otherwise break — the tour.
//
// Wire shape (POST, matches the concierge-api /events endpoint):
//     { propertyId, sessionId, events: [{ type, data? }] }
// The body is sent as a plain string (text/plain), which the server parses as
// JSON anyway — a CORS-safelisted "simple request", so navigator.sendBeacon at
// pagehide needs no preflight and always gets through.

type EventData = Record<string, unknown>;
type QueuedEvent = { type: string, data?: EventData };

const FLUSH_INTERVAL_MS = 5000;     // flush at least this often while queued
const FLUSH_AT_QUEUE_SIZE = 10;     // ...or immediately at this many events
const MAX_BATCH = 20;               // server cap per request (analytics.ts)
const MAX_DATA_CHARS = 500;         // server cap per event's JSON data
const MAX_QUEUE = 100;              // offline retention cap (drop oldest)
const HEARTBEAT_INTERVAL_MS = 30000;

// Lenient read (matches inquiry.ts): settings.json is authored per customer
// and a bad value must never break the tour.
const asText = (value: unknown): string | undefined => {
    return (typeof value === 'string' && value.trim() !== '') ? value.trim() : undefined;
};

// Session id: crypto-random, held in memory only (NEVER persisted). The
// fallbacks keep the shape within the server's ^[a-f0-9-]{8,64}$ contract on
// insecure origins (LAN dev) where crypto.randomUUID is unavailable.
const randomSessionId = (): string => {
    try {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* fall through */ }
    try {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
    }
};

// Where the visit came from: an explicit utm_source wins, then the referrer's
// hostname, then 'direct'. Never more than a coarse origin label — no full
// URLs, no query strings.
const deriveSource = (): string => {
    try {
        const utm = new URLSearchParams(location.search).get('utm_source');
        if (utm && utm.trim() !== '') return utm.trim().slice(0, 64);
    } catch { /* fall through */ }
    try {
        if (document.referrer) {
            const host = new URL(document.referrer).hostname;
            if (host) return host.slice(0, 64);
        }
    } catch { /* fall through */ }
    return 'direct';
};

const init = (global: Global) => {
    const { settings, state, events } = global;

    // Cast-through config (not part of the validated schema core; see v2.ts).
    // Both values are required; anything less leaves the module fully inert.
    const cfg = settings.analytics;
    const endpoint = asText(cfg?.endpoint);
    const propertyId = asText(cfg?.propertyId);
    if (!endpoint || !propertyId) return;

    const sessionId = randomSessionId();

    // ---- queue + batching ---------------------------------------------------
    const queue: QueuedEvent[] = [];
    let flushTimer = 0;

    const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = window.setTimeout(() => {
            flushTimer = 0;
            flush();
        }, FLUSH_INTERVAL_MS);
    };

    // Send everything queued. `useBeacon` is the pagehide path: sendBeacon
    // survives the page teardown; fetch keepalive is the fallback. Every
    // failure is swallowed — losing a beacon must never surface in the tour.
    const flush = (useBeacon = false) => {
        if (queue.length === 0) return;
        if (flushTimer) {
            window.clearTimeout(flushTimer);
            flushTimer = 0;
        }
        // Offline: hold the (capped) queue and retry later instead of burning
        // requests that can only fail.
        if (!useBeacon && navigator.onLine === false) {
            scheduleFlush();
            return;
        }
        while (queue.length > 0) {
            const batch = queue.splice(0, MAX_BATCH);
            try {
                const body = JSON.stringify({ propertyId, sessionId, events: batch });
                if (useBeacon && typeof navigator.sendBeacon === 'function' &&
                    navigator.sendBeacon(endpoint, body)) {
                    continue;
                }
                fetch(endpoint, {
                    method: 'POST',
                    body,
                    keepalive: true
                }).catch(() => { /* fire-and-forget */ });
            } catch { /* fire-and-forget */ }
        }
    };

    const track = (type: string, data?: EventData) => {
        try {
            // Defensive size guard: one oversized payload would 400 the whole
            // batch server-side. Better a bare event than losing its siblings.
            if (data !== undefined && JSON.stringify(data).length > MAX_DATA_CHARS) {
                data = undefined;
            }
            if (queue.length >= MAX_QUEUE) queue.shift();
            queue.push(data === undefined ? { type } : { type, data });
            if (queue.length >= FLUSH_AT_QUEUE_SIZE) {
                flush();
            } else {
                scheduleFlush();
            }
        } catch { /* fire-and-forget */ }
    };

    // ---- open (once, when the scene is ready) --------------------------------
    // Carries the traffic source exactly once per session.
    let opened = false;
    const trackOpen = () => {
        if (opened) return;
        opened = true;
        track('open', { source: deriveSource() });
    };
    if (state.loaded) trackOpen();
    events.on('loaded:changed', (loaded: boolean) => {
        if (loaded) trackOpen();
    });

    // ---- guided tour (Rundgang) ----------------------------------------------
    // Fired by camera-manager.ts: start via the 'tour' control, complete when a
    // non-looping track plays through to its end (interrupt/cancel don't count).
    events.on('tour:start', () => track('tour_start'));
    events.on('tour:complete', () => track('tour_complete'));

    // ---- bird's-eye (drone) views ---------------------------------------------
    // This listener registers before the camera manager's own 'inputEvent'
    // handler (initAnalytics runs before the Viewer is constructed), so
    // state.cameraMode still holds the PREVIOUS mode here: the 'aerial' toggle
    // counts only on the way in. 'aerialGoto' is the direct-jump path (staging,
    // deep features); the silent load-time staging prewarm detour is not a
    // visitor action and is skipped.
    events.on('inputEvent', (name: string, arg?: unknown) => {
        if (name === 'aerial') {
            if (state.cameraMode !== 'aerial') track('aerial', { index: 0 });
        } else if (name === 'aerialGoto') {
            if (!state.prewarming) track('aerial', { index: Math.max(0, Number(arg) | 0) });
        }
    });

    // ---- annotations ----------------------------------------------------------
    events.on('annotation.activate', (annotation: Annotation) => {
        const label = typeof annotation?.title === 'string' ? annotation.title.slice(0, 200) : '';
        track('annotation', { label });
    });

    // ---- feature modules (staging / share / inquiry / concierge) ---------------
    // Producers fire 'analytics' on the global bus (staging.ts, share.ts,
    // inquiry.ts, concierge.ts). With analytics unconfigured nothing listens,
    // so those fires are free no-ops and the modules stay decoupled.
    events.on('analytics', (type: string, data?: EventData) => track(type, data));

    // ---- dwell time -------------------------------------------------------------
    // Active seconds = time the tab was actually visible (hidden tabs don't
    // count). Sent as a session-cumulative counter so a lost beacon only costs
    // precision, never correctness (the server can take the max per session).
    let activeMs = 0;
    let visibleSince: number | null = document.visibilityState === 'visible' ? performance.now() : null;

    const settleVisibility = () => {
        if (visibleSince !== null) {
            activeMs += performance.now() - visibleSince;
            visibleSince = null;
        }
    };

    const activeSeconds = () => Math.round(
        (activeMs + (visibleSince !== null ? performance.now() - visibleSince : 0)) / 1000
    );

    let lastHeartbeatSeconds = 0;
    const heartbeat = () => {
        const seconds = activeSeconds();
        if (seconds <= 0 || seconds === lastHeartbeatSeconds) return;
        lastHeartbeatSeconds = seconds;
        track('heartbeat', { seconds });
    };

    window.setInterval(() => {
        if (document.visibilityState === 'visible') heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Tab hidden or page going away: settle the clock, queue a final heartbeat
    // and push the WHOLE queue out via sendBeacon (fetch keepalive fallback) —
    // the last reliable chance to get data out before the page dies.
    const onHidden = () => {
        settleVisibility();
        heartbeat();
        flush(true);
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            onHidden();
        } else if (visibleSince === null) {
            visibleSince = performance.now();
        }
    });
    window.addEventListener('pagehide', onHidden);
    // bfcache restore: pagehide ran, the page came back — resume the clock.
    window.addEventListener('pageshow', () => {
        if (document.visibilityState === 'visible' && visibleSince === null) {
            visibleSince = performance.now();
        }
    });
};

const initAnalytics = (global: Global) => {
    try {
        init(global);
    } catch (err) {
        // Analytics must never break the tour — not even at init.
        if (global.config.devtools) console.warn('Analytics init failed:', err);
    }
};

export { initAnalytics };
