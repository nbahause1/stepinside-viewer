import type { MetadataRoute } from "next";

// Allow indexing of the public pages; the legal pages opt out via their own
// `robots: { index: false }` metadata and are kept out of the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://www.myinnsyn.de/sitemap.xml",
    host: "https://www.myinnsyn.de",
  };
}
