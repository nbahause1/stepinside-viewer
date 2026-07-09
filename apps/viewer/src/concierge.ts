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
    // scan stays visible behind it. (There was a fullscreen chat-app variant,
    // .chatPill--full; it lost the fight against the iOS keyboard: a viewport-
    // filling fixed panel gets displaced by every keyboard mechanism iOS has.
    // The small bottom-anchored overlay is what native chat widgets use, and
    // iOS's own "reveal the input" shove moves it roughly where it belongs —
    // we only fine-pin it below.) All the current logic — backend contract,
    // limits, contact cards, focus jumps, keyboard invariant — is unchanged.

    // Touch = coarse pointer. Checked at call time (`.matches`) so hybrid
    // devices (iPad + trackpad, convertibles) are classified per interaction.
    const touchDevice = window.matchMedia('(pointer: coarse)');

    // ---- keyboard debug HUD (?kbdebug in the URL) --------------------------
    // iOS soft-keyboard behavior cannot be reproduced in any desktop tooling,
    // so this HUD IS the debugger: it live-prints every value the keyboard
    // logic depends on, big enough to read in a screen recording. Costs
    // nothing unless the flag is present.
    let debugHud: ((event: string) => void) | null = null;
    if (window.location.search.includes('kbdebug')) {
        const hud = document.createElement('div');
        hud.style.cssText =
            'position:fixed;top:60px;left:8px;z-index:9999;pointer-events:none;' +
            'background:rgba(180,0,40,0.85);color:#fff;font:700 15px/1.45 monospace;' +
            'padding:8px 10px;border-radius:8px;white-space:pre;';
        document.body.appendChild(hud);
        const log: string[] = [];
        debugHud = (event: string) => {
            const v = window.visualViewport;
            const ae = document.activeElement;
            log.push(`${(performance.now() / 1000).toFixed(1)}s ${event}`);
            while (log.length > 5) log.shift();
            hud.textContent =
                `innerH ${window.innerHeight}  scrollY ${Math.round(window.scrollY)}\n` +
                `vv.h ${v ? Math.round(v.height) : '-'}  vv.top ${v ? Math.round(v.offsetTop) : '-'}  ` +
                `vv.pageTop ${v ? Math.round(v.pageTop) : '-'}\n` +
                `pillRect.btm ${Math.round(pill.getBoundingClientRect().bottom)}  ` +
                `tf ${pill.style.transform || '-'}\n` +
                `focus ${ae === input ? 'INPUT' : (ae?.id || ae?.tagName || '-')}  ` +
                `val ${input.value.length}ch\n${
                    log.join('\n')}`;
        };
        window.addEventListener('focusin', () => debugHud!('focusin'), true);
        window.addEventListener('focusout', () => debugHud!('focusout'), true);
        setInterval(() => debugHud!('tick'), 500);
    }
    // ------------------------------------------------------------------------

    const vv = window.visualViewport;
    if (vv) {
        // A visual-viewport shrink below this is Safari chrome noise (URL bar
        // collapsing, rounding) — only larger shrinks count as "keyboard up".
        const KEYBOARD_MIN = 60;
        // The keyboard-open/close ANIMATION fires a burst of resize events in
        // which the computed height flickers through 0. Acting on a single
        // reading closed the keyboard right after it opened ("die Tastatur
        // fährt sich wieder ein") — so "keyboard gone" must hold steadily for
        // this long before we act on it.
        const DISMISS_CONFIRM_MS = 250;

        const keyboardHeight = () => Math.max(0, window.innerHeight - vv.height - vv.offsetTop);

        // THE keyboard invariant (touch only): field focused ⟺ keyboard up.
        // iOS raises the keyboard ONLY when an editable element GAINS focus
        // inside a user gesture. Whenever iOS dismisses the keyboard on its own
        // (Done key, scrolling, tab switch …) while the field keeps focus,
        // tapping the already-focused field is a no-op — no focus change, no
        // keyboard, "can't type the second message". Tricks to force a change
        // (synchronous blur()+focus() in touchend) get coalesced by WebKit and
        // don't work. So instead: once the keyboard has verifiably gone away,
        // drop focus too. The next tap is then a genuine focus gain inside a
        // genuine gesture, and iOS brings the keyboard back — native behavior,
        // no tricks. (Same conclusion as react-spectrum PR #7479: remove the
        // touch/focus trickery, let iOS do its thing.)
        let keyboardWasUp = false;
        let dismissTimer: ReturnType<typeof setTimeout> | null = null;
        const cancelDismiss = () => {
            if (dismissTimer !== null) {
                clearTimeout(dismissTimer);
                dismissTimer = null;
            }
        };

        // Cumulative correction currently applied to the pill (px, downwards).
        let pillShift = 0;
        const releasePill = () => {
            pill.style.transform = '';
            pill.style.transition = '';
            pillShift = 0;
        };

        // Keep the small overlay riding ABOVE the on-screen keyboard. iOS
        // mostly shoves the page up by itself to reveal the focused input,
        // but (measured on-device with the HUD) sometimes without firing a
        // single visualViewport event, and not always by the right amount.
        // So: measure where the pill's bottom actually is and pin it to the
        // visible bottom (vv.offsetTop + vv.height, in client coords — true
        // under every displacement mechanism iOS has). Delta-based, so when
        // iOS already shoved correctly this is a no-op.
        const PILL_MARGIN = 14; // matches the pill's CSS bottom offset
        const fitPill = () => {
            pill.style.transition = 'none';
            const target = vv.offsetTop + vv.height - PILL_MARGIN;
            const delta = target - pill.getBoundingClientRect().bottom;
            if (delta !== 0) {
                pillShift += delta;
                pill.style.transform = pillShift !== 0 ? `translateY(${pillShift}px)` : '';
                if (Math.abs(delta) > 2) debugHud?.(`pin Δ${Math.round(delta)} shift=${Math.round(pillShift)}`);
            }
        };

        // ACTIVE pinning while the keyboard is up: a rAF loop re-measures
        // every frame, so silent displacements can't move the chat off the
        // keyboard. Runs only while chat is open AND the keyboard is up.
        //
        // CRITICAL: corrections must WAIT until the viewport has settled.
        // While the keyboard is still animating in, iOS is mid-way through
        // its own reveal-scroll of the focused field; moving the field around
        // in that window makes iOS abort the keyboard ("slides up, slides
        // straight back down, works on the 3rd try"). So while vv events are
        // still streaming (animation running), iOS drives alone — we only
        // correct after SETTLE_MS of silence. The silent no-event shove is
        // still caught: no events IS the settled state.
        const SETTLE_MS = 250;
        let lastVvEvent = 0;
        let pinRaf = 0;
        const pinLoop = () => {
            pinRaf = 0;
            if (!state.chatOpen || keyboardHeight() <= KEYBOARD_MIN) return;
            if (performance.now() - lastVvEvent >= SETTLE_MS) fitPill();
            pinRaf = requestAnimationFrame(pinLoop);
        };
        const stopPin = () => {
            if (pinRaf !== 0) {
                cancelAnimationFrame(pinRaf);
                pinRaf = 0;
            }
        };

        const applyViewport = () => {
            if (!state.chatOpen) {
                releasePill();
                stopPin();
                keyboardWasUp = false;
                cancelDismiss();
                return;
            }
            const keyboardUp = keyboardHeight() > KEYBOARD_MIN;
            if (keyboardUp) {
                messages.scrollTop = messages.scrollHeight;
                if (pinRaf === 0) pinRaf = requestAnimationFrame(pinLoop);
                cancelDismiss();
                debugHud?.(`kb up kbH=${Math.round(keyboardHeight())} shift=${Math.round(pillShift)}`);
            } else {
                releasePill();
                stopPin();
                debugHud?.(`release kbH=${Math.round(keyboardHeight())}`);
                if (keyboardWasUp && dismissTimer === null && touchDevice.matches &&
                    document.activeElement === input) {
                    dismissTimer = setTimeout(() => {
                        dismissTimer = null;
                        // Re-check: still open, still down, still focused.
                        if (state.chatOpen && keyboardHeight() <= KEYBOARD_MIN &&
                            document.activeElement === input) {
                            input.blur();
                            debugHud?.('invariant BLUR');
                        }
                    }, DISMISS_CONFIRM_MS);
                }
            }
            keyboardWasUp = keyboardUp;
        };
        // vv events stamp the settle clock: as long as they stream (keyboard
        // animation, iOS reveal-scroll), pin corrections stay on hold.
        const onVvChange = () => {
            lastVvEvent = performance.now();
            applyViewport();
        };
        vv.addEventListener('resize', onVvChange);
        vv.addEventListener('scroll', onVvChange);
        events.on('chatOpen:changed', applyViewport);
    }

    // Lock body scroll while the fullscreen chat is open. The panel already
    // covers everything (position:fixed inset:0), so we only need to stop the
    // page itself from scrolling — via overflow:hidden, NOT a scroll-position
    // pin. A JS scrollTo() on every scroll event fights iOS's own focus-scroll
    // when you tap the input, which cancels the keyboard from re-opening after
    // the first message (the exact "can't tap the search bar" symptom).
    events.on('chatOpen:changed', (open: boolean) => {
        document.documentElement.style.overflow = open ? 'hidden' : '';
        document.body.style.overflow = open ? 'hidden' : '';
        // Tell the browser the open chat is a dark surface: iOS then renders
        // the on-screen keyboard, its accessory bar and the collapsed URL pill
        // dark instead of glaring white between the black panel and the keys.
        document.documentElement.style.colorScheme = open ? 'dark' : '';
    });

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
};

export { initConcierge };
