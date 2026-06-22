// Bilingual content for StepInside. German is the primary language, English the option.
// The brand name "StepInside" always stays in English.

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
  cards: HeroCard[];
}

interface DemoItem {
  title: string;
  body: string;
}
interface DemosD {
  label: string;
  heading: string;
  intro: string;
  placeholder: string;
  items: DemoItem[];
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
    sub: "Fotorealistische 3D-Touren, durch die sich Ihre Besucher frei bewegen. Ein Link, jedes Gerät, kein Download.",
    ctaPrimary: "Demo ansehen",
    ctaSecondary: "Kontakt aufnehmen",
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
      "Bewegen Sie sich direkt durch unsere Scans. Klicken, ziehen, hineingehen. Genau das erleben auch Ihre Besucher.",
    placeholder: "Live-Scan wird hier eingebettet",
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
      "Von der Aufnahme bis zur fertigen Tour auf Ihrer Website. Transparent und ohne Aufwand für Sie.",
    steps: [
      {
        title: "Aufnahme vor Ort",
        body: "Wir scannen Ihre Innenräume und Außenbereiche vollständig. Ein Termin, keine Vorbereitung Ihrerseits.",
      },
      {
        title: "Aufbereitung",
        body: "Wir bereinigen und optimieren den Scan, bis er flüssig auf jedem Gerät läuft.",
      },
      {
        title: "Anreicherung",
        body: "Wir setzen Hotspots mit Informationen und legen eine geführte Kamerafahrt durch die Highlights an.",
      },
      {
        title: "Lieferung",
        body: "Sie erhalten den Embed-Code, einen druckfertigen QR-Code und eine Anleitung für Ihren Webdesigner.",
      },
    ],
  },
  audience: {
    label: "Für wen",
    heading: "Für alle, die Räume haben.",
    intro:
      "Wenn Menschen Ihren Raum erleben sollen, bevor sie kommen, ist eine begehbare Tour der überzeugendste Weg.",
    items: [
      {
        title: "Hotels",
        body: "Zimmer und Suiten erlebbar machen, bevor gebucht wird.",
      },
      {
        title: "Ferienwohnungen",
        body: "Gäste sehen genau, was sie erwartet. Weniger Rückfragen.",
      },
      {
        title: "Restaurants & Cafés",
        body: "Atmosphäre zeigen, Bereiche und Tische begehbar machen.",
      },
      {
        title: "Immobilien",
        body: "Interessenten gehen durch das Objekt, bevor sie anreisen.",
      },
      {
        title: "Event-Locations",
        body: "Veranstalter planen im echten Raum, aus der Ferne.",
      },
      {
        title: "Einzelhandel & Showrooms",
        body: "Flächen und Sortiment rund um die Uhr begehbar.",
      },
    ],
  },
  about: {
    label: "Über uns",
    heading: "Zwei Welten, eine Idee.",
    paragraphs: [
      "Unser Gründer ist in einer Hotelfamilie aufgewachsen. Tourismus und Gastfreundschaft waren von Kindheit an Alltag, gelebte Praxis im Familienunternehmen, nicht Theorie.",
      "Heute ist er in der Immobilienbranche tätig und verbindet zwei Welten: Hospitality und Immobilien. Aus dieser doppelten Perspektive entstand StepInside.",
      "Die Frage war einfach: Wie lassen sich Hotels, Ferienhäuser und Immobilien authentischer und überzeugender zeigen, als Fotos es je könnten? Die Antwort sind begehbare 3D-Touren, die Räume so zeigen, wie sie wirklich sind. Inklusive der Außenbereiche, die in virtuellen Touren bisher fehlten.",
    ],
  },
  contact: {
    label: "Kontakt",
    heading: "Sprechen wir über Ihre Räume.",
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
    tagline: "Begehbare 3D-Touren für Räume aller Art.",
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
    sub: "Photorealistic 3D tours your visitors can walk through freely. One link, any device, no download.",
    ctaPrimary: "View a demo",
    ctaSecondary: "Get in touch",
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
      "Move through our scans right here. Click, drag, step inside. Exactly what your visitors will experience.",
    placeholder: "Live scan embeds here",
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
      "From the on-site capture to the finished tour on your website. Transparent, with no effort on your side.",
    steps: [
      {
        title: "On-site capture",
        body: "We scan your interiors and outdoor areas in full. One appointment, no preparation on your part.",
      },
      {
        title: "Refinement",
        body: "We clean up and optimise the scan until it runs smoothly on every device.",
      },
      {
        title: "Enrichment",
        body: "We add hotspots with information and a guided camera path through the highlights.",
      },
      {
        title: "Delivery",
        body: "You receive the embed code, a print-ready QR code and a guide for your web designer.",
      },
    ],
  },
  audience: {
    label: "Who it's for",
    heading: "For anyone with a space.",
    intro:
      "When people should experience your space before they arrive, a walkable tour is the most convincing way.",
    items: [
      {
        title: "Hotels",
        body: "Make rooms and suites experienceable before the booking.",
      },
      {
        title: "Holiday rentals",
        body: "Guests see exactly what to expect. Fewer questions.",
      },
      {
        title: "Restaurants & cafés",
        body: "Show the atmosphere, make areas and tables walkable.",
      },
      {
        title: "Real estate",
        body: "Prospects walk through the property before they travel.",
      },
      {
        title: "Event venues",
        body: "Organisers plan in the real space, remotely.",
      },
      {
        title: "Retail & showrooms",
        body: "Floors and ranges, walkable around the clock.",
      },
    ],
  },
  about: {
    label: "About",
    heading: "Two worlds, one idea.",
    paragraphs: [
      "Our founder grew up in a hotel family. Tourism and hospitality were everyday life from childhood, lived practice in the family business, not theory.",
      "Today he works in real estate and connects two worlds: hospitality and property. StepInside grew out of that double perspective.",
      "The question was simple: how can hotels, holiday homes and properties be shown more authentically and convincingly than photos ever could? The answer is walkable 3D tours that show spaces as they really are. Including the outdoor areas that virtual tours have left out until now.",
    ],
  },
  contact: {
    label: "Contact",
    heading: "Let's talk about your spaces.",
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
    impressum: "Imprint",
    datenschutz: "Privacy",
    rights: "All rights reserved.",
    legalAria: "Legal",
  },
};

export const dict: Record<Lang, Dict> = { de, en };
