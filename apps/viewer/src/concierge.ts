import { IdleLook } from './cameras/idle-look';
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
        state.chatOpen = !state.chatOpen;
    });
    closeBtn.addEventListener('click', () => {
        state.chatOpen = false;
    });
    events.on('chatOpen:changed', (open: boolean) => {
        panel.classList.toggle('is-open', open);
        pill.classList.toggle('is-open', open);
        // Focus the field right away AND after the entrance transition starts
        // (AI mode only — scripted mode has no text field). The immediate call
        // matters: while the scene streams in, a queued rAF can lag seconds
        // behind, and anything typed until then would miss the field.
        if (open && mode !== 'scripted') {
            input.focus();
            window.requestAnimationFrame(() => input.focus());
        }
    });

    // The message list scrolls on its own — wheel and pointer gestures over it
    // (and over the suggestion buttons) must not reach the canvas and drive the
    // camera. Shared by both modes.
    messages.addEventListener('wheel', event => event.stopPropagation());
    messages.addEventListener('pointerdown', event => event.stopPropagation());
    suggest.addEventListener('pointerdown', event => event.stopPropagation());

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
    // AI mode takes over the whole viewport like a native chat app (Claude /
    // Gemini style): same DOM as the corner panel, restyled via this modifier.
    // Scripted mode keeps the small corner panel above.
    pill.classList.add('chatPill--full');

    // While the fullscreen chat covers the scene, stop the idle camera drift —
    // otherwise the splat keeps re-rendering behind the opaque panel and the
    // wasted GPU/main-thread work makes typing feel laggy on weaker machines.
    let idleWasSuppressed = false;
    events.on('chatOpen:changed', (open: boolean) => {
        if (open) {
            idleWasSuppressed = IdleLook.suppressed;
            IdleLook.suppressed = true;
        } else {
            IdleLook.suppressed = idleWasSuppressed;
        }
    });

    // Mobile keyboard handling. The panel is position:fixed/inset:0 against the
    // LAYOUT viewport, which iOS Safari does NOT shrink when the on-screen
    // keyboard opens — it pans the VISUAL viewport instead. So the panel stays
    // full-screen (its black surface always covers the whole scene — nothing
    // ever peeks through), and we only lift the input row above the keyboard by
    // padding the panel's bottom by the keyboard's height. The input row is the
    // panel's last flex child, so the padding pushes it up while the messages
    // list shrinks. keyboardH = layout height − visible height − any top pan.
    const vv = window.visualViewport;
    // Whether the on-screen keyboard is currently raised (derived from the
    // visual viewport being shorter than the layout viewport). Drives the
    // tap-to-reopen fix further down. Assumed down when we can't measure.
    let keyboardUp = false;
    if (vv) {
        const applyViewport = () => {
            if (!state.chatOpen) {
                panel.style.paddingBottom = '';
                keyboardUp = false;
                return;
            }
            const keyboardH = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
            keyboardUp = keyboardH > 0;
            panel.style.paddingBottom = keyboardH > 0 ? `${keyboardH}px` : '';
            messages.scrollTop = messages.scrollHeight;
        };
        vv.addEventListener('resize', applyViewport);
        vv.addEventListener('scroll', applyViewport);
        events.on('chatOpen:changed', applyViewport);
    }

    // iOS raises the on-screen keyboard ONLY on a focus CHANGE. After the first
    // answer the field usually still holds focus (we keep it there on purpose so
    // the guest can keep typing), yet iOS has dismissed the keyboard — so tapping
    // the already-focused field is a no-op and no keyboard comes up. That is the
    // "can't type the second message, tapping the bar does nothing" symptom.
    // Force a real focus change inside the tap gesture: blur, then refocus. Only
    // when we can see the keyboard is down, so a normal tap while it's already up
    // never flickers it. touchend is a genuine user gesture, so the refocus is
    // allowed to summon the keyboard.
    input.addEventListener('touchend', () => {
        if (keyboardUp) return;
        if (document.activeElement !== input) return; // first tap: iOS focuses it itself
        input.blur();
        input.focus();
    });

    // Lock body scroll while the fullscreen chat is open. The panel already
    // covers everything (position:fixed inset:0), so we only need to stop the
    // page itself from scrolling — via overflow:hidden, NOT a scroll-position
    // pin. A JS scrollTo() on every scroll event fights iOS's own focus-scroll
    // when you tap the input, which cancels the keyboard from re-opening after
    // the first message (the exact "can't tap the search bar" symptom).
    events.on('chatOpen:changed', (open: boolean) => {
        document.documentElement.style.overflow = open ? 'hidden' : '';
        document.body.style.overflow = open ? 'hidden' : '';
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
    const contactCardJustShown = () =>
        messages.lastElementChild?.classList.contains('chatMsg--contact') === true;

    // The fullscreen chat hides the 3D scene, so a focus answer must not fly
    // the camera blind. Instead the answer gets a "show me" action that closes
    // the chat and then jumps the camera.
    const appendShowAction = (camera: NonNullable<typeof pois[number]['camera']>, label: string) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chatChip chatAction';
        btn.textContent = `Im Rundgang zeigen: ${label}`;
        btn.addEventListener('click', () => {
            state.chatOpen = false;
            events.fire('focusPoi', camera);
        });
        messages.appendChild(btn);
        scrollToBottom();
    };

    // Greeting as the first bot bubble, so the empty fullscreen app has a
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
            input.focus();
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
                // If the answer is about a locatable object, offer to show it
                // (the fullscreen chat covers the scene, so no blind camera fly).
                const poi = data.focus ? pois.find(p => p.id === data.focus) : undefined;
                if (poi) appendShowAction(poi.camera, poi.label);
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
            input.focus();
            scrollToBottom();
        }
    };

    // Tapping the send button must NOT blur the input. On iOS a blur closes the
    // on-screen keyboard, and the post-response input.focus() can't reopen it
    // (reopening the keyboard requires a user gesture — the async callback isn't
    // one). Preventing default on pointer/mouse-down keeps focus on the input,
    // so the keyboard stays up across sends and you can immediately type again.
    // (preventDefault here blocks only the focus shift, not the click event.)
    const keepFocus = (event: Event) => event.preventDefault();
    sendBtn.addEventListener('pointerdown', keepFocus);
    sendBtn.addEventListener('mousedown', keepFocus);
    sendBtn.addEventListener('click', () => {
        send();
        input.focus();  // synchronous, inside the click gesture — keeps iOS keyboard up
    });
    // Keyboard inside the chat must NOT reach the viewer's global shortcuts
    // (1/2/3 switch camera mode, r resets, h toggles help, space play/pause, …).
    // Without this, typing a normal sentence fires those actions and the mode
    // switches steal focus from the field — it looks like you "can't type".
    // Stop every key event from bubbling to the window-level handlers.
    const swallow = (event: KeyboardEvent) => event.stopPropagation();
    input.addEventListener('keyup', swallow);
    input.addEventListener('keypress', swallow);
    input.addEventListener('keydown', (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
        }
    });
};

export { initConcierge };
