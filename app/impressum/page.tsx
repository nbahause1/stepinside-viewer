import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Impressum",
  robots: { index: false, follow: true },
};

// Legal pages are German-only (legally required form) and intentionally plain.
// TODO: replace every bracketed placeholder in lib/config.ts with real data and
// have the final text checked against current German legal requirements.
export default function ImpressumPage() {
  const l = config.legal;
  return (
    <div className="min-h-[100dvh] bg-paper text-ink">
      <header className="border-b border-mist">
        <div className="mx-auto flex h-16 max-w-[760px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="block size-2 rotate-45 bg-ink" aria-hidden="true" />
            <span className="text-[15px] font-bold">StepInside</span>
          </Link>
          <Link
            href="/"
            className="text-[14px] text-smoke transition-colors hover:text-ink"
          >
            Zurück zur Startseite
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-16 md:py-24">
        <h1 className="text-[40px] font-bold leading-[1.1] tracking-[-0.02em]">
          Impressum
        </h1>

        <div className="mt-12 space-y-10 text-[15px] leading-[1.6] text-pewter">
          <section>
            <h2 className="text-[20px] font-bold text-ink">Angaben gemäß § 5 DDG</h2>
            <p className="mt-3">
              {l.company}
              <br />
              {l.owner}
              <br />
              {l.street}
              <br />
              {l.city}
              <br />
              {l.country}
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">Kontakt</h2>
            <p className="mt-3">
              Telefon: {l.phone}
              <br />
              E-Mail: {l.email}
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">Umsatzsteuer-ID</h2>
            <p className="mt-3">{l.vatId}</p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              Verantwortlich für den Inhalt
            </h2>
            <p className="mt-3">
              {l.owner}
              <br />
              {l.street}, {l.city}
            </p>
          </section>

          <p className="border-t border-mist pt-6 text-[13px] text-smoke">
            Hinweis: Dieser Text ist eine Vorlage mit Platzhaltern. Bitte vor dem
            Livegang mit echten Daten ausfüllen und rechtlich prüfen lassen.
          </p>
        </div>
      </main>
    </div>
  );
}
