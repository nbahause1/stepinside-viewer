// Central runtime configuration for StepInside.
// Everything marked TODO must be filled in with real values before launch.

export const config = {
  // Formspree form ID (the part after /f/ in your endpoint, e.g. "xyzabcd").
  // Set it here or via the NEXT_PUBLIC_FORMSPREE_ID environment variable.
  formspreeId: process.env.NEXT_PUBLIC_FORMSPREE_ID ?? "", // TODO

  // Contact details shown on the site.
  email: "hallo@stepinside.eu", // TODO: real address
  phone: "+49 151 0000000", // TODO: real, human-readable number
  phoneHref: "+4915100000000", // TODO: same number, digits only, for tel: links
  calendlyUrl: "", // TODO: e.g. "https://calendly.com/stepinside/intro"

  // Live scan embeds (SuperSplat / iframe src), aligned by index with demos.items.
  // Leave a slot empty ("") to render a labelled placeholder instead of an iframe.
  demoEmbeds: ["", ""] as string[], // TODO: paste embed URLs

  // Scan teaser stills shown in the Demos section (real frames from the scan video).
  // Swap these for per-object scan renders when available.
  demoImages: ["/scan-1.jpg", "/scan-2.jpg"] as string[],

  // Legal entity data used on the Impressum page.
  legal: {
    company: "StepInside",
    owner: "[Vor- und Nachname]", // TODO
    street: "[Straße Nr.]", // TODO
    city: "[PLZ Ort]", // TODO
    country: "Deutschland",
    email: "hallo@stepinside.eu", // TODO
    phone: "+49 151 0000000", // TODO
    vatId: "[USt-IdNr., falls vorhanden]", // TODO
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
