import type { MetadataRoute } from "next";

// Only the indexable pages. Impressum and Datenschutz are noindex, so they are
// intentionally left out.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.myinnsyn.de";
  const lastModified = new Date();
  return [
    { url: base, lastModified, changeFrequency: "monthly", priority: 1 },
    {
      url: `${base}/ueber-uns`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
