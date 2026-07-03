import type { Global } from './types';

// Engagement survey + lead CTA card. Once a visit shows real engagement —
// the guided tour played through, 75 s of accumulated *visible* time, or
// leaving fullscreen after a ≥30 s stint — a light frosted glass card slides
// in bottom-centre and asks, in a single tap, how helpful the tour was on a
// 1-5 scale (1 = gar nicht hilfreich, 5 = sehr hilfreich). A 4-5 rating
// offers two warm CTAs ("Besichtigung anfragen" / "Exposé erhalten") that
// open a three-field mini lead form; lower ratings get a warm "Danke!" and
// the card leaves.
//
// The card rides on the analytics module: survey/cta taps travel through the
// same batched fire-and-forget queue (events.fire('analytics', …) →
// analytics.ts), and the lead form POSTs to settings.survey.leadEndpoint
// (default: the analytics endpoint with /events swapped for /lead). Without
// settings.analytics — or with settings.survey.enabled === false — this
// module is a true no-op: zero DOM, zero listeners, zero timers.
//
// TRUST RULES (privacy is a feature; mirrors analytics.ts):
//   - The viewer stays fully interactive behind the card (no scrim, no
//     blocking), the close X is always visible, nothing is pre-checked and
//     consent is a deliberate tap on an unchecked box.
//   - Asked ONCE per property per device: localStorage `sse:survey:{propertyId}`
//     holds a one-word "answered"/"dismissed" flag — no identifier, no
//     timestamp, nothing that links sessions, visitors or properties.
//   - A trigger that fires while the onboarding tutorial or the staging
//     overlay is up merely WAITS (and a card the staging overlay slides away
//     comes back afterwards) — only an explicit answer or dismissal ("Nein
//     danke" / close X) sets the once-per-device flag.

const ENGAGEMENT_TRIGGER_MS = 75000;    // accumulated visible time that counts as engaged
const ENGAGEMENT_CHECK_MS = 1000;       // how often the engagement clock is compared
const FULLSCREEN_MIN_MS = 30000;        // fullscreen stint that counts as engaged on exit
const BLOCKED_RETRY_MS = 2000;          // re-check cadence while tutorial/staging block the card
const THANKS_CLOSE_MS = 2400;           // linger on the plain "Danke!" before sliding away
const SUCCESS_CLOSE_MS = 3200;          // linger on the lead-sent confirmation
const HIDE_ANIM_MS = 450;               // matches the CSS exit transition

// Lenient read (matches analytics.ts): settings.json is authored per customer
// and a bad value must never break the tour.
const asText = (value: unknown): string | undefined => {
    return (typeof value === 'string' && value.trim() !== '') ? value.trim() : undefined;
};

// ".../events" → ".../lead" (the concierge-api pairing); any other analytics
// endpoint shape gets "/lead" appended to its base.
const deriveLeadEndpoint = (eventsEndpoint: string): string => {
    const base = eventsEndpoint.replace(/\/+$/, '');
    return base.endsWith('/events') ? `${base.slice(0, -'/events'.length)}/lead` : `${base}/lead`;
};

// The single contact field auto-detects what it holds: an e-mail address or a
// phone number. Deliberately loose — it only guards against entries that are
// clearly neither, it must never bounce a real person.
const detectContact = (value: string): 'email' | 'phone' | undefined => {
    const v = value.trim();
    if (/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(v)) return 'email';
    if (/^\+?\d[\d\s()/.-]{5,}$/.test(v)) return 'phone';
    return undefined;
};

// Card markup (created lazily at trigger time — an unconfigured or already-
// answered build never carries this DOM). Styles live in index.scss
// (#surveyCard, incl. the (pointer: coarse) static-glass override).
const CARD_HTML = `
    <button type="button" class="survey__close" aria-label="Schließen" title="Schließen">
        <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true">
            <path d="M6 6 L16 16 M16 6 L6 16" />
        </svg>
    </button>
    <div class="survey__step" data-step="rate">
        <div class="survey__title">Wie hilfreich war dieser Rundgang für dich?</div>
        <div class="survey__emojis">
            <button type="button" class="survey__emoji" data-rating="1" data-label="1" aria-label="1 – gar nicht hilfreich" title="Gar nicht hilfreich">1</button>
            <button type="button" class="survey__emoji" data-rating="2" data-label="2" aria-label="2" title="Wenig hilfreich">2</button>
            <button type="button" class="survey__emoji" data-rating="3" data-label="3" aria-label="3" title="Teils-teils">3</button>
            <button type="button" class="survey__emoji" data-rating="4" data-label="4" aria-label="4" title="Hilfreich">4</button>
            <button type="button" class="survey__emoji" data-rating="5" data-label="5" aria-label="5 – sehr hilfreich" title="Sehr hilfreich">5</button>
        </div>
        <div class="survey__scaleHint"><span>1 = gar nicht hilfreich</span><span>5 = sehr hilfreich</span></div>
    </div>
    <div class="survey__step hidden" data-step="cta">
        <div class="survey__title">Danke! Magst du direkt weitergehen?</div>
        <div class="survey__ctas">
            <button type="button" class="survey__cta" data-cta="besichtigung">Besichtigung anfragen</button>
            <button type="button" class="survey__cta survey__cta--secondary" data-cta="expose">Exposé erhalten</button>
        </div>
        <button type="button" class="survey__decline">Nein, danke</button>
    </div>
    <form class="survey__step survey__form hidden" data-step="form" novalidate>
        <div class="survey__title" data-role="formTitle">Besichtigung anfragen</div>
        <input class="survey__input" name="name" type="text" placeholder="Dein Name" autocomplete="name" />
        <input class="survey__input" name="contact" type="text" placeholder="E-Mail oder Telefon" autocomplete="email" />
        <textarea class="survey__input" name="message" rows="2" placeholder="Nachricht (optional)"></textarea>
        <label class="survey__consent">
            <input type="checkbox" name="consent" />
            <span>Ich bin einverstanden, dass meine Angaben zur Kontaktaufnahme gespeichert
                werden. <a href="/datenschutz" target="_blank" rel="noopener noreferrer">Datenschutz</a></span>
        </label>
        <div class="survey__error hidden" data-role="error" aria-live="polite"></div>
        <button type="submit" class="survey__cta" data-role="submit">Absenden</button>
    </form>
    <div class="survey__step survey__thanks hidden" data-step="thanks" aria-live="polite"></div>
`;

const init = (global: Global) => {
    const { settings, state, events } = global;

    // The survey rides on analytics: without its endpoint + propertyId there is
    // nowhere to send answers or leads, so the module stays fully inert.
    // settings.survey.enabled defaults to true once analytics is configured.
    const analyticsEndpoint = asText(settings.analytics?.endpoint);
    const propertyId = asText(settings.analytics?.propertyId);
    if (!analyticsEndpoint || !propertyId) return;

    const cfg = settings.survey;
    if (cfg?.enabled === false) return;

    // Once per property per device. The flag is set ONLY on an explicit answer
    // or dismissal (see markAsked) — never merely because the card appeared.
    const storageKey = `sse:survey:${propertyId}`;
    try {
        if (localStorage.getItem(storageKey) !== null) return;
    } catch { /* storage unavailable (private mode): worst case we ask again */ }

    const leadEndpoint = asText(cfg?.leadEndpoint) ?? deriveLeadEndpoint(analyticsEndpoint);

    const markAsked = (value: 'answered' | 'dismissed') => {
        try {
            // never downgrade "answered" to "dismissed" (X after answering)
            if (localStorage.getItem(storageKey) === null) {
                localStorage.setItem(storageKey, value);
            }
        } catch { /* fire-and-forget */ }
    };

    // The card must never fight the onboarding, cover the staging overlay's
    // "Original zeigen" peek, pop up over a running guided tour (cameraMode
    // 'anim'), or land on top of the open concierge chat panel. (While staging
    // is open, CSS also slides an already-visible card away — body.staging-open
    // — and back afterwards.)
    const blocked = () => {
        return document.body.classList.contains('tutorial-active') ||
            document.body.classList.contains('staging-open') ||
            state.cameraMode === 'anim' ||
            state.chatOpen;
    };

    // ---- card ---------------------------------------------------------------

    let card: HTMLDivElement | null = null;

    const close = () => {
        if (!card) return;
        const el = card;
        card = null;
        el.classList.remove('visible');
        window.setTimeout(() => el.remove(), HIDE_ANIM_MS);
    };

    const dismiss = () => {
        markAsked('dismissed');
        close();
    };

    const wire = (root: HTMLDivElement) => {
        const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

        const showStep = (name: string) => {
            root.querySelectorAll<HTMLElement>('.survey__step').forEach((el) => {
                el.classList.toggle('hidden', el.dataset.step !== name);
            });
        };

        const showThanks = (text: string, closeAfterMs: number) => {
            q('[data-step="thanks"]').textContent = text;
            showStep('thanks');
            window.setTimeout(close, closeAfterMs);
        };

        // Interactions on the card must never reach the canvas/camera, and keys
        // typed into the form must not fire the viewer's global shortcuts
        // (same rationale as the concierge input; see concierge.ts).
        root.addEventListener('pointerdown', e => e.stopPropagation());
        root.addEventListener('wheel', e => e.stopPropagation());
        root.addEventListener('keydown', e => e.stopPropagation());
        root.addEventListener('keyup', e => e.stopPropagation());
        root.addEventListener('keypress', e => e.stopPropagation());

        q('.survey__close').addEventListener('click', dismiss);
        q('.survey__decline').addEventListener('click', dismiss);

        // -- step 1: one-tap rating ------------------------------------------
        root.querySelectorAll<HTMLButtonElement>('.survey__emoji').forEach((btn) => {
            btn.addEventListener('click', () => {
                const rating = Number(btn.dataset.rating) || 0;
                markAsked('answered');
                // anonymous usage signal via the analytics queue
                events.fire('analytics', 'survey', { rating, label: btn.dataset.label });
                // 1-5 helpfulness scale: 4-5 flows into the CTAs
                if (rating >= 4) {
                    showStep('cta');
                } else {
                    showThanks('Danke für dein Feedback!', THANKS_CLOSE_MS);
                }
            });
        });

        // -- step 2: CTAs (only reached after a 4-5 rating) --------------------
        let interest = 'besichtigung';
        root.querySelectorAll<HTMLButtonElement>('.survey__cta[data-cta]').forEach((btn) => {
            btn.addEventListener('click', () => {
                interest = btn.dataset.cta ?? 'besichtigung';
                events.fire('analytics', 'cta_click', { cta: interest });
                q('[data-role="formTitle"]').textContent =
                    interest === 'expose' ? 'Exposé erhalten' : 'Besichtigung anfragen';
                showStep('form');
            });
        });

        // -- step 3: mini lead form --------------------------------------------
        const form = q<HTMLFormElement>('[data-step="form"]');
        const nameInput = form.elements.namedItem('name') as HTMLInputElement;
        const contactInput = form.elements.namedItem('contact') as HTMLInputElement;
        const messageInput = form.elements.namedItem('message') as HTMLTextAreaElement;
        const consentInput = form.elements.namedItem('consent') as HTMLInputElement;
        const submitBtn = q<HTMLButtonElement>('[data-role="submit"]');
        const errorEl = q('[data-role="error"]');

        const showError = (text: string) => {
            errorEl.textContent = text;
            errorEl.classList.remove('hidden');
        };

        // auto-detect: nudge the browser's autofill/keyboard toward what the
        // visitor is actually typing into the single contact field
        contactInput.addEventListener('input', () => {
            const kind = detectContact(contactInput.value);
            if (kind) {
                contactInput.setAttribute('autocomplete', kind === 'email' ? 'email' : 'tel');
                contactInput.setAttribute('inputmode', kind === 'email' ? 'email' : 'tel');
            }
        });

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const name = nameInput.value.trim();
            const contact = contactInput.value.trim();
            const message = messageInput.value.trim();
            if (name === '') {
                showError('Bitte sag uns kurz deinen Namen.');
                return;
            }
            if (contact === '' || !detectContact(contact)) {
                showError('Bitte gib eine gültige E-Mail-Adresse oder Telefonnummer an.');
                return;
            }
            if (!consentInput.checked) {
                showError('Bitte bestätige die Einwilligung, damit wir dich kontaktieren dürfen.');
                return;
            }
            errorEl.classList.add('hidden');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Wird gesendet…';

            // A lead is a deliberate inquiry — unlike analytics events it is NOT
            // fire-and-forget: a failure is surfaced so the visitor can retry.
            // (The form contents stay intact either way.)
            const fail = (text: string) => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Absenden';
                showError(text);
            };
            fetch(leadEndpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    propertyId,
                    name,
                    contact,
                    message: message !== '' ? message : undefined,
                    interest,
                    consent: true
                })
            }).then((res) => {
                if (res.status === 429) {
                    // shared-WiFi rate cap: an immediate retry fails too, so
                    // don't suggest one — ask for a little patience instead
                    fail('Gerade viele Anfragen — bitte versuch es in ein paar Minuten nochmal.');
                    return;
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                showThanks('Danke! Wir melden uns zeitnah.', SUCCESS_CLOSE_MS);
            }).catch(() => {
                fail('Das hat leider nicht geklappt. Bitte versuch es gleich nochmal.');
            });
        });
    };

    const show = () => {
        if (card) return;
        card = document.createElement('div');
        card.id = 'surveyCard';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', 'Kurzes Feedback');
        card.innerHTML = CARD_HTML;
        wire(card);
        (document.getElementById('ui') ?? document.body).appendChild(card);
        // entrance on the next frame so the slide-in transition runs
        const el = card;
        requestAnimationFrame(() => el.classList.add('visible'));
    };

    // ---- trigger plumbing -----------------------------------------------------
    // Whichever fires first wins; a blocked trigger politely waits (poll) until
    // the tutorial/staging clears. Waiting or sliding away never sets the flag.

    let triggered = false;
    let retryTimer = 0;
    let engagementTimer = 0;

    const trigger = () => {
        if (triggered) return;
        triggered = true;
        window.clearInterval(engagementTimer);
        if (blocked()) {
            retryTimer = window.setInterval(() => {
                if (!blocked()) {
                    window.clearInterval(retryTimer);
                    show();
                }
            }, BLOCKED_RETRY_MS);
        } else {
            show();
        }
    };

    // -- trigger 1: the guided tour ("Rundgang") played through ---------------
    events.on('tour:complete', trigger);

    // -- trigger 2: 75 s of ACCUMULATED visible engagement ---------------------
    // Same visibility bookkeeping as the analytics dwell clock: hidden tabs do
    // not count, and the clock only arms once the scene has actually loaded (a
    // slow download is not engagement).
    let activeMs = 0;
    let visibleSince: number | null = null;
    let clockArmed = false;

    const armClock = () => {
        if (clockArmed) return;
        clockArmed = true;
        if (document.visibilityState === 'visible') visibleSince = performance.now();
    };
    if (state.loaded) armClock();
    events.on('loaded:changed', (loaded: boolean) => {
        if (loaded) armClock();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (visibleSince !== null) {
                activeMs += performance.now() - visibleSince;
                visibleSince = null;
            }
        } else if (clockArmed && visibleSince === null) {
            visibleSince = performance.now();
        }
    });

    const engagedMs = () => {
        return activeMs + (visibleSince !== null ? performance.now() - visibleSince : 0);
    };

    engagementTimer = window.setInterval(() => {
        if (engagedMs() >= ENGAGEMENT_TRIGGER_MS) trigger();
    }, ENGAGEMENT_CHECK_MS);

    // -- trigger 3: exiting fullscreen after a ≥30 s stint ----------------------
    // Only where the real Fullscreen API exists: on iPhone Safari ui.ts fakes
    // isFullscreen by flipping it on every orientation change, and a mere
    // device rotation is not an engagement signal.
    if (document.fullscreenEnabled) {
        let fullscreenSince: number | null = null;
        events.on('isFullscreen:changed', (on: boolean) => {
            if (on) {
                fullscreenSince = performance.now();
            } else {
                if (fullscreenSince !== null &&
                    performance.now() - fullscreenSince >= FULLSCREEN_MIN_MS) {
                    trigger();
                }
                fullscreenSince = null;
            }
        });
    }
};

const initSurvey = (global: Global) => {
    try {
        init(global);
    } catch (err) {
        // The survey must never break the tour — not even at init.
        if (global.config.devtools) console.warn('Survey init failed:', err);
    }
};

export { initSurvey };
