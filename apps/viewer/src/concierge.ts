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
        // Focus the field after the entrance transition starts (AI mode only —
        // scripted mode has no text field).
        if (open && mode !== 'scripted') {
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
    // Curated jump targets for this scan. The model only sees {id,label,keywords}
    // so it can pick a focus; the camera pose stays here and never goes server-side.
    const focusList = pois.map(p => ({ id: p.id, label: p.label, keywords: p.keywords }));

    const history: ChatMessage[] = [];
    let loading = false;
    let thinking: HTMLElement | null = null;

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

    const setLoading = (value: boolean) => {
        loading = value;
        input.disabled = value;
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
                // If the answer is about a locatable object, fly the camera there.
                const poi = data.focus ? pois.find(p => p.id === data.focus) : undefined;
                if (poi) events.fire('focusPoi', poi.camera);
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

    sendBtn.addEventListener('click', () => {
        send();
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
