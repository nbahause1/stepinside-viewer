import { Global } from './types';

// Per-scan white-label branding (settings.branding), applied once at init:
//   - #brandDome wordmark pill: `logoUrl` (image) beats `logoText` (text)
//     beats the stock StepInside mark
//   - browser tab title: "{title} — StepInside"
//   - accent color: overrides the --accent custom property that drives the
//     viewer accent (toggles, active tabs, camera switch etc.)
// The info panel keeps "StepInside Viewer" — that's the engine brand.
//
// Reading is deliberately lenient: settings.json is authored per customer and
// a bad value must never break the tour — it just falls back to the default
// (validateV2 additionally strips invalid values, but the visitor path only
// casts, so we re-check here).

const asText = (value: unknown): string | undefined => {
    return (typeof value === 'string' && value.trim() !== '') ? value.trim() : undefined;
};

const makeWord = (text: string): HTMLSpanElement => {
    const word = document.createElement('span');
    word.className = 'brandMark__word';
    word.textContent = text;
    return word;
};

const initBranding = (global: Global) => {
    const { branding } = global.settings;
    if (!branding || typeof branding !== 'object') {
        return;
    }

    const title = asText(branding.title);
    const logoText = asText(branding.logoText);
    const logoUrl = asText(branding.logoUrl);
    const accentColor = asText(branding.accentColor);

    // browser tab: "{title} — StepInside" (the engine brand stays as suffix)
    if (title) {
        document.title = `${title} — StepInside`;
    }

    // top-centre wordmark pill
    const inner = document.querySelector('#brandDome .brandMark__inner');
    if (inner) {
        if (logoUrl) {
            const img = document.createElement('img');
            img.className = 'brandMark__logo';
            img.alt = title ?? logoText ?? '';
            img.draggable = false;

            // if the customer logo fails to load, fall back to the text mark
            // (or restore the StepInside mark when no text was provided)
            const stock = Array.from(inner.childNodes);
            img.onerror = () => {
                if (logoText) {
                    inner.replaceChildren(makeWord(logoText));
                } else {
                    inner.replaceChildren(...stock);
                }
            };

            img.src = logoUrl;
            inner.replaceChildren(img);
        } else if (logoText) {
            inner.replaceChildren(makeWord(logoText));
        }
    }

    // accent override (ignored gracefully if the value isn't a valid CSS color)
    if (accentColor && CSS.supports('color', accentColor)) {
        document.documentElement.style.setProperty('--accent', accentColor);
    }
};

export { initBranding };
