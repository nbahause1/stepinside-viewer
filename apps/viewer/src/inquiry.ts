import type { Global } from './types';

// In-viewer lead capture ("Besichtigung anfragen"). A discreet glass CTA pill
// in the top-right corner turns a visitor into an inquiry:
//
//   settings.inquiry.url    — tap opens the customer's booking/contact page in
//                             a new tab (takes precedence over everything).
//   lead form               — with analytics configured (and the survey module
//                             not disabled), tap opens the in-viewer mini lead
//                             form ('inquiry:open' → survey.ts). Preferred over
//                             mailto: a desktop without a configured mail
//                             client silently does NOTHING on mailto links.
//   settings.inquiry.email  — mailto fallback; the subject is
//                             settings.inquiry.subject or
//                             "Anfrage: {branding.title or document.title}".
//
// The pill stays hidden unless one of the targets is available, so a build
// without lead capture never shows a dead button. `label` overrides the
// default "Besichtigung anfragen".

// Lenient read (matches branding.ts): settings.json is authored per customer
// and a bad value must never break the tour.
const asText = (value: unknown): string | undefined => {
    return (typeof value === 'string' && value.trim() !== '') ? value.trim() : undefined;
};

const initInquiry = (global: Global) => {
    const { settings, events } = global;

    const cfg = settings.inquiry;
    const url = asText(cfg?.url);
    const email = asText(cfg?.email);
    // Mirrors the survey module's own activation check (survey.ts): when it is
    // live, it listens for 'inquiry:open' and owns the lead flow.
    const leadFormAvailable =
        !!asText(settings.analytics?.endpoint) &&
        !!asText(settings.analytics?.propertyId) &&
        settings.survey?.enabled !== false;
    if (!url && !email && !leadFormAvailable) return;

    const pill = document.getElementById('inquiryPill');
    const trigger = document.getElementById('inquiryTrigger');
    const label = document.getElementById('inquiryLabel');
    if (!pill || !trigger || !label) return;

    // On narrow phones the pill collapses to its icon (see index.scss), so the
    // accessible name/tooltip must carry the label too.
    const labelText = asText(cfg?.label) ?? 'Besichtigung anfragen';
    label.textContent = labelText;
    trigger.setAttribute('aria-label', labelText);
    trigger.setAttribute('title', labelText);

    trigger.addEventListener('click', () => {
        // anonymous usage signal (no-op unless analytics is configured)
        events.fire('analytics', 'inquiry_click', {
            target: url ? 'url' : (leadFormAvailable ? 'form' : 'email')
        });
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
        }
        if (leadFormAvailable) {
            events.fire('inquiry:open');
            return;
        }
        // initBranding runs first, so branding.title (when set) names the
        // property; document.title is the already-branded fallback.
        const subject = asText(cfg?.subject) ??
            `Anfrage: ${asText(settings.branding?.title) ?? document.title}`;
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}`;
    });

    // Reveal only once wiring succeeded (mirrors the concierge/staging pills).
    pill.classList.remove('hidden');
};

export { initInquiry };
