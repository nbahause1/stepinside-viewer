import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Datenschutz",
  robots: { index: false, follow: true },
};

// TODO: this is a minimal starting point. Have a full, current DSGVO-compliant
// privacy policy prepared (ideally with a lawyer or a reputable generator) and
// list every third party actually in use (Vercel hosting, Formspree, Calendly).
export default function DatenschutzPage() {
  const l = config.legal;
  return (
    <div className="min-h-[100dvh] bg-paper text-ink">
      <header className="border-b border-mist">
        <div className="mx-auto flex h-16 max-w-[760px] items-center justify-between px-6">
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
            <span className="block size-2 rotate-45 bg-ink" aria-hidden="true" />
            <span className="text-[15px] font-bold">StepInside</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-16 md:py-24">
        <h1 className="text-[40px] font-bold leading-[1.1] tracking-[-0.02em]">
          Datenschutzerklärung
        </h1>

        <div className="mt-12 space-y-10 text-[15px] leading-[1.6] text-pewter">
          <section>
            <h2 className="text-[20px] font-bold text-ink">Verantwortlicher</h2>
            <p className="mt-3">
              {l.company}, {l.owner}
              <br />
              {l.street}, {l.city}
              <br />
              E-Mail: {l.email}
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">Hosting</h2>
            <p className="mt-3">
              Diese Website wird bei Vercel gehostet. Beim Aufruf werden technisch
              notwendige Daten wie die IP-Adresse verarbeitet, um die Seite
              auszuliefern. Rechtsgrundlage ist das berechtigte Interesse an einem
              sicheren und zuverlässigen Betrieb.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">Kontaktformular</h2>
            <p className="mt-3">
              Wenn Sie das Kontaktformular nutzen, werden die eingegebenen Daten
              über den Dienst Formspree verarbeitet und an uns weitergeleitet, um
              Ihre Anfrage zu beantworten. Die Daten werden nicht ohne Ihre
              Einwilligung für andere Zwecke verwendet.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">Terminbuchung</h2>
            <p className="mt-3">
              Für die Terminbuchung verlinken wir auf den Dienst Calendly. Beim
              Aufruf gelten die Datenschutzbestimmungen des jeweiligen Anbieters.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">Ihre Rechte</h2>
            <p className="mt-3">
              Sie haben das Recht auf Auskunft, Berichtigung, Löschung,
              Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch.
              Wenden Sie sich dazu an {l.email}.
            </p>
          </section>

          <p className="border-t border-mist pt-6 text-[13px] text-smoke">
            Hinweis: Dieser Text ist eine gekürzte Vorlage mit Platzhaltern und
            ersetzt keine vollständige, rechtlich geprüfte Datenschutzerklärung.
          </p>
        </div>
      </main>
    </div>
  );
}
