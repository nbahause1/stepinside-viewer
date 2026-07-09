// Bilingual content for innsyn. German is the primary language, English the option.
// The brand name "innsyn" always stays in English.

export type Lang = "de" | "en";

interface NavD {
  demos: string;
  process: string;
  audience: string;
  about: string;
  contact: string;
  cta: string;
  menu: string;
  close: string;
  ariaLabel: string;
  langSwitchAria: string;
}

interface HeroCard {
  title: string;
  body: string;
}
interface HeroD {
  label: string;
  headline: string;
  sub: string;
  ctaPrimary: string;
  ctaSecondary: string;
  scrollHint: string;
  emailPlaceholder: string;
  requesting: string;
  requestHint: string;
  requestSuccess: string;
  requestError: string;
  cards: HeroCard[];
}

interface DemoItem {
  title: string;
  body: string;
}
interface DemosGate {
  overline: string;
  heading: string;
  body: string;
  cta: string;
  placeholder: string;
  sending: string;
  success: string;
  error: string;
}
interface DemosD {
  label: string;
  heading: string;
  intro: string;
  placeholder: string;
  fullscreen: string;
  exitFullscreen: string;
  fullscreenHint: string;
  items: DemoItem[];
  gate: DemosGate;
}

interface Step {
  title: string;
  body: string;
}
interface ProcessD {
  label: string;
  heading: string;
  intro: string;
  steps: Step[];
}

interface AudienceItem {
  title: string;
  body: string;
  /** Short pain-point punchline, shown on its own emphasised line. */
  benefit: string;
}
interface AudienceD {
  label: string;
  heading: string;
  intro: string;
  items: AudienceItem[];
}

interface AboutD {
  label: string;
  heading: string;
  paragraphs: string[];
}

interface ContactD {
  label: string;
  heading: string;
  intro: string;
  nameLabel: string;
  emailLabel: string;
  messageLabel: string;
  namePlaceholder: string;
  emailPlaceholder: string;
  messagePlaceholder: string;
  send: string;
  sending: string;
  success: string;
  error: string;
  directLabel: string;
  bookLabel: string;
}

interface FooterD {
  tagline: string;
  about: string;
  impressum: string;
  datenschutz: string;
  rights: string;
  legalAria: string;
}

export interface Dict {
  nav: NavD;
  hero: HeroD;
  demos: DemosD;
  process: ProcessD;
  audience: AudienceD;
  about: AboutD;
  contact: ContactD;
  footer: FooterD;
}

const de: Dict = {
  nav: {
    demos: "Demos",
    process: "Ablauf",
    audience: "Für wen",
    about: "Über uns",
    contact: "Kontakt",
    cta: "Kontakt aufnehmen",
    menu: "Menü",
    close: "Schließen",
    ariaLabel: "Hauptnavigation",
    langSwitchAria: "Sprache wechseln",
  },
  hero: {
    label: "Begehbare 3D-Touren",
    headline: "Räume begehbar machen. Von überall.",
    sub: "Fotorealistische 3D-Touren, durch die sich Ihre Besucher frei bewegen.",
    ctaPrimary: "Zum Scan",
    ctaSecondary: "Kontakt aufnehmen",
    scrollHint: "Nach unten scrollen",
    emailPlaceholder: "Ihre E-Mail-Adresse",
    requesting: "Wird gesendet...",
    requestHint: "Exklusiver Zugang zu einer persönlichen Demo.",
    requestSuccess: "Danke. Wir melden uns mit Ihrem Zugang.",
    requestError: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
    cards: [
      {
        title: "Frei begehbar",
        body: "Bewegen Sie sich in jede Ecke. Innen und außen.",
      },
      { title: "Kein Download", body: "Ein Link genügt. Auf jedem Gerät." },
    ],
  },
  demos: {
    label: "Demos",
    heading: "Sehen Sie selbst.",
    intro:
      "Bewegen Sie sich direkt durch unsere Scans. Klicken, ziehen, hineingehen. Genau dieses Erlebnis bekommen Ihre Gäste direkt auf Ihrer Website.",
    placeholder: "Live-Scan wird hier eingebettet",
    fullscreen: "Vollbild",
    exitFullscreen: "Vollbild schließen",
    fullscreenHint: "In den Vollbildmodus schalten, um den Scan zu begehen",
    gate: {
      overline: "Begehbarer Scan",
      heading: "Begehbaren Scan anfordern",
      body: "Geben Sie Ihre E-Mail ein und wir senden Ihnen einen begehbaren Scan zum Erkunden.",
      cta: "Scan anfordern",
      placeholder: "Ihre E-Mail-Adresse",
      sending: "Wird gesendet...",
      success: "Danke. Ihr begehbarer Scan ist unterwegs.",
      error: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
    },
    items: [
      {
        title: "Hotel-Suite",
        body: "Vom Eingang bis zum Balkon. Gäste erkunden den Raum, bevor sie buchen.",
      },
      {
        title: "Restaurant",
        body: "Durch den Gastraum gehen und die Atmosphäre vor dem Besuch erleben.",
      },
    ],
  },
  process: {
    label: "Ablauf",
    heading: "Wie wir arbeiten.",
    intro:
      "Von der Aufnahme bis zur fertigen Tour auf Ihrer Website.\nTransparent und ohne Aufwand für Sie.",
    steps: [
      {
        title: "Aufnahme vor Ort",
        body: "Wir scannen Ihre Innenräume und Außenbereiche vollständig. Ein Termin reicht, vorbereiten müssen Sie nichts.",
      },
      {
        title: "Aufbereitung",
        body: "Wir bereinigen und optimieren den Scan, bis er flüssig auf jedem Gerät läuft.",
      },
      {
        title: "Abstimmung",
        body: "Wir prüfen die Tour final und stimmen sie mit Ihnen ab, inklusive einer Korrekturschleife.",
      },
      {
        title: "Lieferung",
        body: "Sie erhalten den Embed-Code, einen druckfertigen QR-Code und eine Anleitung für Ihren Webdesigner. Optional erweitern wir gerne selbst ihre Website.",
      },
    ],
  },
  audience: {
    label: "Für wen",
    heading: "Für alle, die Räume und Flächen haben.",
    intro:
      "Wenn Menschen Ihre Räume und Außenbereiche erleben sollen, bevor sie kommen, ist eine begehbare Tour der überzeugendste Weg.",
    items: [
      {
        title: "Hotels",
        body: "Zimmer und Suiten erlebbar machen, bevor gebucht wird.",
        benefit: "Mehr Direktbuchungen.",
      },
      {
        title: "Ferienwohnungen",
        body: "Gäste sehen genau, was sie erwartet, drinnen wie draußen.",
        benefit: "Weniger Rückfragen.",
      },
      {
        title: "Restaurants & Cafés",
        body: "Atmosphäre zeigen, Bereiche und Tische begehbar machen.",
        benefit: "Mehr Reservierungen.",
      },
      {
        title: "Immobilien",
        body: "Interessenten gehen durch das Objekt, bevor sie anreisen.",
        benefit: "Qualifiziertere Anfragen.",
      },
      {
        title: "Event-Locations",
        body: "Veranstalter planen im echten Raum, aus der Ferne.",
        benefit: "Schnellere Zusagen.",
      },
      {
        title: "Einzelhandel & Showrooms",
        body: "Flächen und Sortiment rund um die Uhr begehbar.",
        benefit: "Mehr Reichweite.",
      },
    ],
  },
  about: {
    label: "Über uns",
    heading: "Wie innsyn entstanden ist.",
    paragraphs: [
      "Ich bin in einer Hotelfamilie groß geworden. Gastfreundschaft und der Umgang mit Gästen gehörten bei uns von klein auf zum Alltag. Schon früh habe ich gemerkt, wie viel der erste Eindruck ausmacht, wenn jemand einen Raum zum ersten Mal betritt.",
      "Heute arbeite ich in der Immobilienbranche, und dort begegnet mir immer wieder dasselbe Problem: Fotos zeigen nie das ganze Bild. Man sieht ein paar Ausschnitte, aber nicht, wie sich ein Raum wirklich anfühlt. Aus diesen beiden Welten, Hotellerie und Immobilien, ist innsyn entstanden.",
      "Unsere begehbaren 3D-Touren lösen genau das. Man bewegt sich frei durch das Objekt, drinnen wie draußen, und bekommt ein echtes Gefühl dafür, wie es vor Ort ist, ohne selbst dort gewesen zu sein. Gerade die Außenbereiche, die in virtuellen Touren bisher gefehlt haben, gehören für uns selbstverständlich dazu.",
    ],
  },
  contact: {
    label: "Kontakt",
    heading: "Sprechen wir über Ihre Projekte.",
    intro:
      "Erzählen Sie uns kurz von Ihrem Objekt. Wir melden uns mit den nächsten Schritten.",
    nameLabel: "Name",
    emailLabel: "E-Mail",
    messageLabel: "Nachricht",
    namePlaceholder: "Ihr Name",
    emailPlaceholder: "name@beispiel.de",
    messagePlaceholder: "Worum geht es? Welche Räume möchten Sie zeigen?",
    send: "Nachricht senden",
    sending: "Wird gesendet...",
    success: "Danke. Wir melden uns in Kürze.",
    error:
      "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut oder schreiben Sie uns direkt.",
    directLabel: "Direkt erreichen",
    bookLabel: "Termin buchen",
  },
  footer: {
    tagline: "Begehbare 3D-Touren für Räume und Flächen aller Art.",
    about: "Über uns",
    impressum: "Impressum",
    datenschutz: "Datenschutz",
    rights: "Alle Rechte vorbehalten.",
    legalAria: "Rechtliches",
  },
};

const en: Dict = {
  nav: {
    demos: "Demos",
    process: "Process",
    audience: "Who it's for",
    about: "About",
    contact: "Contact",
    cta: "Get in touch",
    menu: "Menu",
    close: "Close",
    ariaLabel: "Main navigation",
    langSwitchAria: "Switch language",
  },
  hero: {
    label: "Walkable 3D tours",
    headline: "Make spaces walkable. From anywhere.",
    sub: "Photorealistic 3D tours your visitors can walk through freely.",
    ctaPrimary: "To the scan",
    ctaSecondary: "Get in touch",
    scrollHint: "Scroll down",
    emailPlaceholder: "Your email address",
    requesting: "Sending...",
    requestHint: "Exclusive access to a personal demo.",
    requestSuccess: "Thank you. We will be in touch with your access.",
    requestError: "Something went wrong. Please try again.",
    cards: [
      {
        title: "Walk anywhere",
        body: "Move into every corner. Indoors and out.",
      },
      { title: "No download", body: "One link is enough. On any device." },
    ],
  },
  demos: {
    label: "Demos",
    heading: "See for yourself.",
    intro:
      "Move through our scans right here. Click, drag, step inside. Your guests get this exact experience, right on your website.",
    placeholder: "Live scan embeds here",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    fullscreenHint: "Switch to fullscreen to walk through the scan",
    gate: {
      overline: "Walkable scan",
      heading: "Request a walkable scan",
      body: "Enter your email and we will send you a walkable scan to explore.",
      cta: "Request scan",
      placeholder: "Your email address",
      sending: "Sending...",
      success: "Thank you. Your walkable scan is on its way.",
      error: "Something went wrong. Please try again.",
    },
    items: [
      {
        title: "Hotel suite",
        body: "From the entrance to the balcony. Guests explore the room before they book.",
      },
      {
        title: "Restaurant",
        body: "Walk through the dining room and feel the atmosphere before visiting.",
      },
    ],
  },
  process: {
    label: "Process",
    heading: "How we work.",
    intro:
      "From the on-site capture to the finished tour on your website.\nTransparent, with no effort on your side.",
    steps: [
      {
        title: "On-site capture",
        body: "We scan your interiors and outdoor areas in full. One appointment is enough, there's nothing for you to prepare.",
      },
      {
        title: "Refinement",
        body: "We clean up and optimise the scan until it runs smoothly on every device.",
      },
      {
        title: "Review",
        body: "We review the final tour and sign it off with you, including one round of revisions.",
      },
      {
        title: "Delivery",
        body: "You receive the embed code, a print-ready QR code and a guide for your web designer. Optionally, we are happy to extend your website ourselves.",
      },
    ],
  },
  audience: {
    label: "Who it's for",
    heading: "For anyone with spaces, indoors and out.",
    intro:
      "When people should experience your indoor and outdoor spaces before they arrive, a walkable tour is the most convincing way.",
    items: [
      {
        title: "Hotels",
        body: "Make rooms and suites experienceable before the booking.",
        benefit: "More direct bookings.",
      },
      {
        title: "Holiday rentals",
        body: "Guests see exactly what to expect, indoors and out.",
        benefit: "Fewer questions.",
      },
      {
        title: "Restaurants & cafés",
        body: "Show the atmosphere, make areas and tables walkable.",
        benefit: "More reservations.",
      },
      {
        title: "Real estate",
        body: "Prospects walk through the property before they travel.",
        benefit: "More qualified enquiries.",
      },
      {
        title: "Event venues",
        body: "Organisers plan in the real space, remotely.",
        benefit: "Faster commitments.",
      },
      {
        title: "Retail & showrooms",
        body: "Floors and ranges, walkable around the clock.",
        benefit: "More reach.",
      },
    ],
  },
  about: {
    label: "About",
    heading: "How innsyn came to be.",
    paragraphs: [
      "I grew up in a hotel family. Hospitality and looking after guests were part of everyday life for us from early on. I learned quickly how much a first impression matters the moment someone walks into a room for the first time.",
      "Today I work in real estate, and I keep running into the same problem: photos never tell the whole story. You see a few angles, but not how a space actually feels. innsyn grew out of those two worlds, hospitality and property.",
      "Our walkable 3D tours fix exactly that. You move freely through the space, inside and out, and get a real sense of how it is on site without ever having been there. The outdoor areas that virtual tours have always left out are a natural part of it for us.",
    ],
  },
  contact: {
    label: "Contact",
    heading: "Let's talk about your projects.",
    intro:
      "Tell us briefly about your property. We will get back to you with the next steps.",
    nameLabel: "Name",
    emailLabel: "Email",
    messageLabel: "Message",
    namePlaceholder: "Your name",
    emailPlaceholder: "name@example.com",
    messagePlaceholder: "What is it about? Which spaces would you like to show?",
    send: "Send message",
    sending: "Sending...",
    success: "Thank you. We will be in touch shortly.",
    error: "Something went wrong. Please try again or email us directly.",
    directLabel: "Reach us directly",
    bookLabel: "Book a call",
  },
  footer: {
    tagline: "Walkable 3D tours for spaces of every kind.",
    about: "About",
    impressum: "Imprint",
    datenschutz: "Privacy",
    rights: "All rights reserved.",
    legalAria: "Legal",
  },
};

export const dict: Record<Lang, Dict> = { de, en };
