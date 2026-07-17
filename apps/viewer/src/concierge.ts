import { shieldFromViewer } from './dom-shield';
import type { Global } from './types';

// Concierge chat. A small dark-glass pill expands into a chat panel. Two modes,
// chosen by settings.concierge.mode:
//
//   'scripted' — no backend at all. The panel shows a greeting and one tappable
//     button per point of interest that carries a question/answer. Tapping shows
//     the fixed answer and flies the camera to that POI. Used for the website
//     demo: always works, no API key, no server.
//
//   'ai' (default) — a server-side Claude answers freely from owner-provided
//     facts. The Anthropic API key never reaches the browser: we POST only
//     { propertyId, messages, room } to the configured endpoint; the server
//     injects the system prompt + knowledge base and calls the model.

// Roles we keep in the running conversation (mirrors the server's message shape).
type ChatRole = 'user' | 'assistant';

type ChatMessage = {
    role: ChatRole,
    content: string
};

// Shape of the endpoint's JSON response. `focus` (when present) is the id of a
// point of interest the camera should jump to (usage is opaque; we don't read it).
type ConciergeResponse = {
    answer: string,
    focus?: string | null,
    // Id of a nearby place (settings.surroundings.pois) — the neighbourhood
    // map opens and draws the walking route there (see surroundings.ts).
    mapPoi?: string | null,
    // Live-searched place (server-side find_place tool): the map opens and
    // routes to these coordinates ("Wo ist der nächste MediaMarkt?").
    mapPlace?: { name: string, address?: string, lngLat: [number, number] } | null,
    // True when the question was about sizes/dimensions/fit — the viewer
    // glides to the bird's-eye view where the authored room dimensions
    // (settings.rooms) are overlaid. Ignored when none are authored.
    showDimensions?: boolean,
    // True when the model answered with the fallback message (question not
    // covered by the knowledge base) — we render the contact buttons then.
    fallback?: boolean,
    usage?: unknown
};

// Keep at most this many turns of history so the request body stays small and
// the server's per-request cap (12) is never exceeded.
const MAX_HISTORY = 12;

const initConcierge = (global: Global) => {
    const { app, settings, state, events } = global;

    // Resolve mode + where to talk to. settings.concierge is the canonical
    // source; window.CONCIERGE_ENDPOINT is a host-page fallback (AI mode only).
    const cfg = settings.concierge;
    const mode = cfg?.mode ?? 'ai';
    const endpoint = cfg?.endpoint ?? window.CONCIERGE_ENDPOINT;
    const propertyId = cfg?.propertyId ?? '';

    // AI mode needs a backend; scripted mode needs nothing. Without either, leave
    // the DOM inert so a misconfigured build never shows a dead button.
    if (mode !== 'scripted' && (!endpoint || !propertyId)) return;

    const pill = document.getElementById('chatPill');
    const toggle = document.getElementById('chatToggle');
    const panel = document.getElementById('chatPanel');
    const closeBtn = document.getElementById('chatClose');
    const messages = document.getElementById('chatMessages');
    const suggest = document.getElementById('chatSuggest');
    const inputRow = document.getElementById('chatInputRow');
    const input = document.getElementById('chatInput') as HTMLInputElement | null;
    const sendBtn = document.getElementById('chatSend') as HTMLButtonElement | null;
    if (!pill || !toggle || !panel || !closeBtn || !messages || !suggest || !inputRow || !input || !sendBtn) return;

    // Reveal the pill (hidden until wiring succeeds so a misconfigured build
    // never shows a dead button).
    pill.classList.remove('hidden');

    const pois = settings.pois ?? [];

    const scrollToBottom = () => {
        messages.scrollTop = messages.scrollHeight;
    };

    // Append a chat bubble. `text` is set via textContent so guest/model content
    // is never interpreted as HTML. `side` is the visual lane, independent of the
    // wire role ('bot' covers assistant answers and local status messages).
    const appendBubble = (side: 'user' | 'bot', text: string): HTMLElement => {
        const el = document.createElement('div');
        el.className = `chatMsg chatMsg--${side}`;
        el.textContent = text;
        messages.appendChild(el);
        scrollToBottom();
        return el;
    };

    // Open/close is state-driven so anything else (e.g. Esc handling) can toggle
    // it; the Proxy fires `chatOpen:changed`. Shared by both modes.
    toggle.addEventListener('click', () => {
        // Touch devices in AI mode hand off to the standalone chat page
        // (chat.html, same directory). The in-viewer overlay lost a five-round
        // war against the iOS on-screen keyboard — every fixed-position chat
        // over the WebGL canvas gets displaced or cancels the keyboard; a
        // plain scrolling document has none of these problems. Back button
        // returns to the tour (bfcache keeps the scene alive). Desktop keeps
        // the overlay panel — no on-screen keyboard, no war.
        if (mode !== 'scripted' && window.matchMedia('(pointer: coarse)').matches) {
            // Carry the current room over so the standalone chat can send the
            // same room context the in-viewer panel would.
            try {
                sessionStorage.setItem('conciergeRoom', currentRoom() ?? '');
            } catch { /* storage blocked (private mode) — chat just omits it */ }
            window.location.href = 'chat.html';
            return;
        }
        state.chatOpen = !state.chatOpen;
    });
    closeBtn.addEventListener('click', () => {
        state.chatOpen = false;
    });
    events.on('chatOpen:changed', (open: boolean) => {
        panel.classList.toggle('is-open', open);
        pill.classList.toggle('is-open', open);
        if (mode === 'scripted') return;
        if (open) {
            // Runs synchronously inside the toggle tap's gesture, so iOS also
            // raises the on-screen keyboard right away.
            input.focus();
        } else {
            // Never leave a focused field behind the closed panel — a focused
            // field with the keyboard down is the iOS stuck state where the
            // next tap on it does nothing (see the keyboard invariant below).
            input.blur();
        }
    });

    // Nothing inside the chat may leak to the viewer underneath: pointer
    // gestures must not drive the camera, wheel must not zoom, typed keys must
    // not fire hotkeys — and, critically, clicks must not bubble up to #ui.
    // ui.ts blurs document.activeElement after EVERY #ui click ("free the
    // keyboard for hotkeys"); the chat lives inside #ui, so each tap on the
    // input field focused it and was instantly blurred again by that handler.
    // On iOS that means the on-screen keyboard closes / never opens — the
    // "can't type the second message" bug. Shared by both modes.
    shieldFromViewer(pill, { hasInput: mode !== 'scripted' });

    // ---------------------------------------------------------------- scripted
    if (mode === 'scripted') {
        // No text input in scripted mode.
        inputRow.classList.add('hidden');

        const greeting = cfg?.greeting;
        if (greeting) appendBubble('bot', greeting);

        // One suggestion button per POI that carries a question + answer.
        let hasChips = false;
        for (const poi of pois) {
            const question = poi.question;
            const answer = poi.answer;
            if (!question || !answer) continue;

            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chatChip';
            chip.textContent = question;
            chip.addEventListener('click', () => {
                // anonymous usage signal (no-op unless analytics is configured):
                // in scripted mode the chip label is the "question"
                events.fire('analytics', 'concierge_question', { question: question.slice(0, 300), mode: 'scripted' });
                appendBubble('user', question);
                appendBubble('bot', answer);
                // Fly the camera to the object the answer is about.
                if (poi.camera) events.fire('focusPoi', poi.camera);
            });
            suggest.appendChild(chip);
            hasChips = true;
        }
        if (hasChips) suggest.classList.remove('hidden');

        return;
    }

    // -------------------------------------------------------------------- ai
    // AI mode uses the SAME small glass corner panel as scripted mode — the
    // scan stays visible behind it. This panel only ever opens on devices
    // with a fine pointer (mouse/trackpad): touch devices are handed off to
    // the standalone chat.html by the toggle handler above, because a text
    // input in a fixed overlay over the WebGL canvas is unwinnable against
    // the iOS on-screen keyboard (five failed rounds — see git history of
    // this file — before the page-handoff architecture ended the war).

    // Touch = coarse pointer. Checked at call time (`.matches`) so hybrid
    // devices (iPad + trackpad, convertibles) are classified per interaction.
    const touchDevice = window.matchMedia('(pointer: coarse)');


    // Type-anywhere: while the chat is open, every printable key lands in the
    // input no matter what currently holds focus. Focus is fragile here — the
    // deferred focus() can lag seconds behind while the scene streams in, and
    // a stray click on the panel background blurs the field — both read as
    // "typing is broken". Capture phase so the keystroke is rerouted before
    // the viewer's window-level camera/hotkey handlers can consume it.
    const typeAnywhere = (event: KeyboardEvent) => {
        if (!state.chatOpen) return;
        if (event.target === input) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        // Another editable field owns the keystroke (e.g. the surroundings
        // address search) — never steal focus from it.
        const t = event.target as HTMLElement | null;
        if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)) return;
        // The map overlay sits ON TOP of the chat when both are open — the
        // top-most layer owns the keyboard, so type-anywhere stands down.
        const surroundings = document.getElementById('surroundingsOverlay');
        if (surroundings && surroundings.classList.contains('is-open')) return;
        if (event.key.length === 1 || event.key === 'Backspace') {
            input.focus();  // the key's default action now inserts into the input
            event.stopPropagation();
        }
    };
    window.addEventListener('keydown', typeAnywhere, true);

    // Curated jump targets for this scan. The model only sees {id,label,keywords}
    // so it can pick a focus; the camera pose stays here and never goes server-side.
    const focusList = pois.map(p => ({ id: p.id, label: p.label, keywords: p.keywords }));

    // Soft conversation limit: after this many sent questions the chat offers
    // the broker contact card. Pure UX (leads a warm prospect to a human); the
    // server's burst + daily buckets enforce the hard cost caps.
    const softLimit = cfg?.softLimit ?? 8;
    const contact = cfg?.contact;
    const hasContact = !!(contact && (contact.phone || contact.email || contact.url || contact.exposeUrl));
    let userTurns = 0;
    let contactCardShown = false;
    let fallbackCardShown = false;

    const history: ChatMessage[] = [];
    let loading = false;
    let thinking: HTMLElement | null = null;

    // Broker contact card: a bot-side bubble with tap-able phone / mail /
    // appointment links. Built via createElement + textContent so settings data
    // is never interpreted as HTML.
    const appendContactCard = (intro: string) => {
        if (!hasContact || !contact) return;
        const el = document.createElement('div');
        el.className = 'chatMsg chatMsg--bot chatMsg--contact';
        const text = document.createElement('div');
        text.textContent = intro;
        el.appendChild(text);
        const addLink = (href: string, label: string) => {
            const a = document.createElement('a');
            a.className = 'chatContactLink';
            a.href = href;
            a.textContent = label;
            a.rel = 'noopener';
            el.appendChild(a);
        };
        const addExternalLink = (href: string, label: string) => {
            const a = document.createElement('a');
            a.className = 'chatContactLink';
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = label;
            el.appendChild(a);
        };
        if (contact.phone) addLink(`tel:${contact.phone.replace(/\s+/g, '')}`, `Anrufen: ${contact.phone}`);
        if (contact.url) addExternalLink(contact.url, 'Termin vereinbaren');
        if (contact.email) addLink(`mailto:${contact.email}`, 'E-Mail schreiben');
        if (contact.exposeUrl) addExternalLink(contact.exposeUrl, 'Exposé ansehen');
        messages.appendChild(el);
        scrollToBottom();
    };

    // True when the last thing in the transcript is already a contact card —
    // guards against stacking cards when several fallbacks come in a row.
    const contactCardJustShown = () => messages.lastElementChild?.classList.contains('chatMsg--contact') === true;

    // Greeting as the first bot bubble, so the empty panel has a
    // starting point (mirrors the scripted panel).
    const greeting = cfg?.greeting;
    if (greeting) appendBubble('bot', greeting);

    // MVP: the room is just the loaded scene's name (or null). Phase 2 swaps in
    // camera-vs-bounding-box zone detection; the wire contract stays the same.
    const currentRoom = (): string | null => app.root.findByName('gsplat')?.name ?? null;

    // An animated "typing" bubble shown while we await the answer.
    const showThinking = () => {
        const el = document.createElement('div');
        el.className = 'chatMsg chatMsg--bot chatMsg--thinking';
        el.setAttribute('aria-label', 'Concierge denkt nach');
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('span');
            dot.className = 'chatDot';
            el.appendChild(dot);
        }
        messages.appendChild(el);
        thinking = el;
        scrollToBottom();
    };

    const clearThinking = () => {
        if (thinking) {
            thinking.remove();
            thinking = null;
        }
    };

    // While the answer loads only the SEND path is blocked — the field itself
    // stays editable so the guest can already type the next question (locking
    // the input for the 3-5s round-trip reads as "typing is broken").
    const setLoading = (value: boolean) => {
        loading = value;
        sendBtn.disabled = value;
    };

    // Hand focus back after a send resolves — desktop/keyboard only. On touch,
    // an async focus() can never raise the iOS keyboard (no user gesture), it
    // would only re-create the focused-but-keyboard-down stuck state that the
    // keyboard invariant above exists to prevent. On touch the field either
    // still has focus (the send button never took it) and the keyboard is
    // simply still up, or the guest re-taps the field — which now always works.
    const refocusAfterSend = () => {
        if (!touchDevice.matches) input.focus();
    };

    const send = async () => {
        if (loading) return;
        const content = input.value.trim();
        if (!content) return;

        history.push({ role: 'user', content });
        if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
        appendBubble('user', content);
        input.value = '';

        // anonymous usage signal (no-op unless analytics is configured): the
        // question the visitor deliberately typed, truncated for the wire cap
        events.fire('analytics', 'concierge_question', { question: content.slice(0, 300), mode: 'ai' });

        setLoading(true);
        showThinking();

        // Offline: don't even attempt the request.
        if (!navigator.onLine) {
            clearThinking();
            appendBubble('bot', 'Keine Verbindung. Bitte prüfe dein Internet und versuch es erneut.');
            setLoading(false);
            refocusAfterSend();
            return;
        }

        try {
            const res = await fetch(endpoint as string, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    propertyId,
                    messages: history,
                    room: currentRoom(),
                    pois: focusList
                })
            });

            clearThinking();

            if (!res.ok) {
                // The server's 429 carries `reason`: 'daily' is terminal for
                // today (hard cost cap) -> hand over to the broker; 'burst'
                // just means slow down.
                let reason = '';
                try {
                    reason = ((await res.json()) as { reason?: string }).reason ?? '';
                } catch { /* body not JSON -> generic message below */ }
                if (res.status === 429 && reason === 'daily') {
                    appendBubble('bot', 'Das Fragen-Kontingent für heute ist aufgebraucht.');
                    if (hasContact) {
                        appendContactCard(`${contact?.name ?? 'Ihr Ansprechpartner'} beantwortet Ihre Fragen gern persönlich:`);
                    }
                    return;
                }
                const text = res.status === 429 ?
                    'Zu viele Anfragen. Bitte warte einen Moment und versuch es erneut.' :
                    'Da ist etwas schiefgelaufen. Bitte versuch es gleich nochmal.';
                appendBubble('bot', text);
                return;
            }

            const data = await res.json() as ConciergeResponse;
            const answer = typeof data.answer === 'string' ? data.answer : '';
            if (answer) {
                history.push({ role: 'assistant', content: answer });
                if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
                appendBubble('bot', answer);
                // If the answer is about a locatable object, glide the camera
                // there — the scan is visible behind the small panel.
                const poi = data.focus ? pois.find(p => p.id === data.focus) : undefined;
                if (poi?.camera) events.fire('focusPoi', poi.camera);
                // Surroundings answer ("wo ist der nächste Supermarkt?"): open
                // the neighbourhood map and draw the walking route. The camera
                // focus and the map are mutually exclusive by construction —
                // focus ids and mapPoi ids come from different lists.
                if (typeof data.mapPoi === 'string' && data.mapPoi.length > 0) {
                    events.fire('surroundings:show', data.mapPoi);
                } else if (data.mapPlace && Array.isArray(data.mapPlace.lngLat)) {
                    // Live-searched place (find_place tool): same map, but the
                    // destination is an arbitrary coordinate, not a curated POI.
                    events.fire('surroundings:showPlace', {
                        label: data.mapPlace.name,
                        detail: data.mapPlace.address ?? '',
                        lngLat: data.mapPlace.lngLat
                    });
                } else if (data.showDimensions === true && !poi &&
                    Array.isArray(settings.rooms) && settings.rooms.length > 0 &&
                    state.cameraMode !== 'aerial') {
                    // Size/dimension answer: glide up to the bird's-eye view,
                    // where the authored room dimensions are overlaid — the
                    // visitor reads the numbers in space while the chat cites
                    // them. Camera focus and map win over this (they answer
                    // more specific intents); no-op when already up there or
                    // when the scan has no authored dimensions.
                    events.fire('inputEvent', 'aerial');
                }
                userTurns += 1;
                if (data.fallback === true && hasContact && !fallbackCardShown && !contactCardJustShown()) {
                    // The bot couldn't answer -> hand over with tap-able actions,
                    // not just a "please contact the broker" sentence. Once per
                    // conversation — repeating the card after every unanswered
                    // question feels pushy; later answers still name the broker.
                    fallbackCardShown = true;
                    appendContactCard(`Am schnellsten hilft Ihnen ${contact?.name ?? 'Ihr Ansprechpartner'} direkt weiter:`);
                } else if (userTurns >= softLimit && !contactCardShown && hasContact && !contactCardJustShown()) {
                    // Soft limit reached: once, after a real answer, offer the human.
                    contactCardShown = true;
                    appendContactCard(`Gern können Sie alles Weitere direkt mit ${contact?.name ?? 'Ihrem Ansprechpartner'} besprechen:`);
                }
            } else {
                appendBubble('bot', 'Da ist etwas schiefgelaufen. Bitte versuch es gleich nochmal.');
            }
        } catch (err) {
            console.warn('Concierge request failed:', err);
            clearThinking();
            appendBubble('bot', 'Da ist etwas schiefgelaufen. Bitte versuch es gleich nochmal.');
        } finally {
            setLoading(false);
            refocusAfterSend();
            scrollToBottom();
        }
    };

    // Tapping the send button must NOT blur the input. On iOS a blur closes the
    // on-screen keyboard mid-send; keeping focus on the field means the
    // keyboard simply stays up across sends and the guest can type on.
    // (preventDefault here blocks only the focus shift, not the click event.)
    const keepFocus = (event: Event) => event.preventDefault();
    sendBtn.addEventListener('pointerdown', keepFocus);
    sendBtn.addEventListener('mousedown', keepFocus);
    sendBtn.addEventListener('click', () => {
        send();
        input.focus();  // synchronous, inside the tap gesture — legal on iOS, keeps/raises the keyboard
    });
    // Enter sends. Key events never reach the viewer's global hotkeys (1/2/3,
    // r, space, …) — shieldFromViewer() stops them at the panel boundary.
    input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
        }
    });

    // --- Touch handoff, return leg -------------------------------------------
    // On touch the chat lives in the standalone chat.html (see the toggle
    // handler above). Camera-coupled answers (dimensions view, map route, POI
    // focus) can't run over there — the chat page stores the chosen action in
    // sessionStorage and navigates back here, and THIS consumer executes it:
    // instantly on a bfcache restore (pageshow), after load otherwise. The
    // action mapping mirrors the desktop panel's precedence exactly.
    const ACTION_MAX_AGE_MS = 5 * 60 * 1000;
    const runPendingAction = () => {
        let raw: string | null = null;
        try {
            raw = sessionStorage.getItem('conciergeAction');
            if (raw !== null) sessionStorage.removeItem('conciergeAction');
        } catch { return; /* storage blocked — nothing to do */ }
        if (!raw) return;
        let action: { type?: string; id?: string; label?: string; detail?: string; lngLat?: unknown; ts?: number };
        try {
            action = JSON.parse(raw);
        } catch { return; }
        // Stale actions (old tab, revisit much later) must not yank the camera.
        if (typeof action.ts !== 'number' || Date.now() - action.ts > ACTION_MAX_AGE_MS) return;
        if (action.type === 'focus' && typeof action.id === 'string') {
            const poi = pois.find(p => p.id === action.id);
            if (poi?.camera) events.fire('focusPoi', poi.camera);
        } else if (action.type === 'mapPoi' && typeof action.id === 'string') {
            events.fire('surroundings:show', action.id);
        } else if (action.type === 'mapPlace' && Array.isArray(action.lngLat)) {
            events.fire('surroundings:showPlace', {
                label: String(action.label ?? ''),
                detail: String(action.detail ?? ''),
                lngLat: action.lngLat
            });
        } else if (action.type === 'dimensions' &&
            Array.isArray(settings.rooms) && settings.rooms.length > 0 &&
            state.cameraMode !== 'aerial') {
            events.fire('inputEvent', 'aerial');
        }
    };
    const runWhenReady = () => {
        if (state.loaded) {
            runPendingAction();
        } else {
            // Fresh page load: the scene isn't up yet — run once it is. The
            // stored action is consumed on first execution, so a second
            // registration (pageshow + init) stays harmless.
            events.once('loaded:changed', runPendingAction);
        }
    };
    // bfcache restore fires pageshow (persisted) with the scene alive; a fresh
    // load may fire pageshow before this init ran, hence the direct call too.
    window.addEventListener('pageshow', runWhenReady);
    runWhenReady();
};

export { initConcierge };
