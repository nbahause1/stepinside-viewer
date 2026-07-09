import type { Metadata } from "next";
import { Montserrat, Lora } from "next/font/google";
import { config } from "@/lib/config";
import SmoothScroll from "@/components/ui/SmoothScroll";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  weight: ["300", "400", "500", "600"],
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
  weight: ["400"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://stepinside.eu"),
  title: {
    default: "innsyn - Räume begehbar machen. Von überall.",
    template: "%s · innsyn",
  },
  description:
    "Fotorealistische, frei begehbare 3D-Touren für Hotels, Immobilien, Gastronomie und mehr. Ein Link, jedes Gerät, kein Download.",
  openGraph: {
    title: "innsyn - Räume begehbar machen. Von überall.",
    description:
      "Fotorealistische, frei begehbare 3D-Touren. Ein Link, jedes Gerät, kein Download.",
    url: "https://stepinside.eu",
    siteName: "innsyn",
    locale: "de_DE",
    type: "website",
  },
  alternates: {
    canonical: "https://stepinside.eu",
    // The English version is deactivated for launch (no switcher in the UI);
    // the EN dictionary is kept in the codebase for later.
    languages: {
      de: "https://stepinside.eu",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const l = config.legal;
  const [postalCode, ...localityParts] = l.city.split(" ");
  // schema.org Organization so search engines understand who is behind the site
  // (name, location in Koblenz, contact) — better local SEO and trust. The
  // contact e-mail is deliberately absent: it stays on the legally required
  // Impressum, but is kept out of machine-readable markup that scrapers harvest.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: l.company,
    url: "https://stepinside.eu",
    description:
      "Fotorealistische, frei begehbare 3D-Touren für Hotels, Immobilien, Gastronomie und mehr.",
    telephone: l.phone,
    founder: { "@type": "Person", name: l.owner },
    address: {
      "@type": "PostalAddress",
      streetAddress: l.street,
      postalCode,
      addressLocality: localityParts.join(" "),
      addressCountry: "DE",
    },
    areaServed: "DE",
  };
  return (
    <html
      lang="de"
      className={`${montserrat.variable} ${lora.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
