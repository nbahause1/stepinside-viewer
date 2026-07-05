import deJson from './locales/de.json';

// StepInside ships German only (product decision). This keeps the inherited
// [data-i18n]/localize() plumbing — the geerbte SuperSplat chrome (tooltips,
// settings labels, the info panel) still resolves its strings through here —
// but there is exactly one dictionary and no locale detection. To go
// multilingual again, restore the dictionaries map + detectLocale from git
// history and add the locale JSONs back.
type Dictionary = Record<string, string>;

const de: Dictionary = deJson;

// Look up a key in the German dictionary, falling back to the key itself so a
// missing translation is visible rather than blank.
const localize = (key: string): string => de[key] ?? key;

// Replace the text of every `[data-i18n]` element with its German string. Call
// once after the DOM is parsed and before any code reads localized strings.
const initLocalization = () => {
    document.documentElement.lang = 'de';
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
        el.textContent = localize(el.dataset.i18n);
    });
};

export { initLocalization, localize };
