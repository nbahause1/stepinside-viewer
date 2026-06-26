// Central runtime configuration for StepInside.
// Everything marked TODO must be filled in with real values before launch.

export const config = {
  // Formspree form ID (the part after /f/ in your endpoint, e.g. "xyzabcd").
  // Set it here or via the NEXT_PUBLIC_FORMSPREE_ID environment variable.
  formspreeId: process.env.NEXT_PUBLIC_FORMSPREE_ID ?? "", // TODO

  // Contact details shown on the site.
  email: "kurieronline6@gmail.com",
  phone: "+49 151 27060110", // human-readable
  phoneHref: "+4915127060110", // same number, digits only, for tel: links
  calendlyUrl: "", // TODO: e.g. "https://calendly.com/stepinside/intro"

  // Live scan embeds (SuperSplat / iframe src), aligned by index with demos.items.
  // Leave a slot empty ("") to render a labelled placeholder instead of an iframe.
  demoEmbeds: ["", ""] as string[], // TODO: paste embed URLs

  // The walkable viewer embedded in the Demos section. The built viewer is
  // bundled into this site at public/viewer/ (run `npm run sync:viewer` after
  // changing the viewer), so it ships on the same domain — no second host, no
  // CORS. Override with NEXT_PUBLIC_VIEWER_URL only if hosting it elsewhere.
  viewerEmbedUrl: process.env.NEXT_PUBLIC_VIEWER_URL ?? "/viewer/index.html",

  // Scan teaser stills shown in the Demos section (real frames from the scan video).
  // Swap these for per-object scan renders when available.
  demoImages: ["/scan-1.jpg", "/scan-2.jpg"] as string[],

  // Legal entity data used on the Impressum page.
  legal: {
    company: "StepInside",
    owner: "Hauke Braband",
    street: "Saurbornstraße 19",
    city: "56073 Koblenz",
    country: "Deutschland",
    email: "kurieronline6@gmail.com",
    phone: "+49 151 27060110",
    vatId: "", // Kleinunternehmer / keine USt-IdNr → Abschnitt wird ausgeblendet
  },
} as const;

// Anchor IDs shared between the navigation and the section components.
export const SECTION_IDS = {
  top: "top",
  demos: "demos",
  process: "ablauf",
  audience: "fuer-wen",
  about: "ueber-uns",
  contact: "kontakt",
  gate: "demo-anfordern",
} as const;
