import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://stepinside.eu"),
  title: {
    default: "StepInside - Räume begehbar machen. Von überall.",
    template: "%s · StepInside",
  },
  description:
    "Fotorealistische, frei begehbare 3D-Touren für Hotels, Immobilien, Gastronomie und mehr. Ein Link, jedes Gerät, kein Download.",
  openGraph: {
    title: "StepInside - Räume begehbar machen. Von überall.",
    description:
      "Fotorealistische, frei begehbare 3D-Touren. Ein Link, jedes Gerät, kein Download.",
    url: "https://stepinside.eu",
    siteName: "StepInside",
    locale: "de_DE",
    type: "website",
  },
  alternates: {
    canonical: "https://stepinside.eu",
    languages: {
      de: "https://stepinside.eu",
      en: "https://stepinside.eu/?lang=en",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-parchment text-ink">
        {children}
      </body>
    </html>
  );
}
