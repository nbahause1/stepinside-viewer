import type { Metadata } from "next";
import Link from "next/link";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import About from "@/components/sections/About";

export const metadata: Metadata = {
  title: "Über uns",
  description:
    "Die Geschichte hinter innsyn: Hospitality und Immobilien, verbunden zu begehbaren 3D-Touren.",
};

export default function UeberUnsPage() {
  return (
    <LanguageProvider>
      <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
        <header className="border-b border-mist">
          <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
            <Link
              href="/"
              className="group inline-flex items-center gap-1.5 text-[14px] text-smoke transition-colors hover:text-ink"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className="transition-transform duration-200 group-hover:-translate-x-0.5"
              >
                <path
                  d="M10 3.5 5.5 8l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Zurück zur Startseite
            </Link>
            <Link href="/" className="flex items-center gap-2">
              <span
                className="block size-2 rotate-45 bg-ink"
                aria-hidden="true"
              />
              <span className="text-[15px] font-bold">innsyn</span>
            </Link>
          </div>
        </header>

        <main className="flex-1">
          <About />
        </main>
      </div>
    </LanguageProvider>
  );
}
