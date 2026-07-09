import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Datenschutz",
  robots: { index: false, follow: true },
};

// Privacy policy tailored to the services actually in use (Vercel hosting,
// Formspree contact form, locally-hosted fonts, no analytics/tracking, the
// same-domain 3D viewer + localStorage). Verantwortlicher comes from
// config.legal. If services change (e.g. Calendly or a live AI concierge are
// enabled), add the matching section. The owner should have it legally reviewed.
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
            <span className="text-[15px] font-bold">innsyn</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-16 md:py-24">
        <h1 className="text-[40px] font-bold leading-[1.1] tracking-[-0.02em]">
          Datenschutzerklärung
        </h1>

        <div className="mt-12 space-y-10 text-[15px] leading-[1.6] text-pewter">
          <section>
            <h2 className="text-[20px] font-bold text-ink">
              1. Verantwortlicher
            </h2>
            <p className="mt-3">
              Verantwortlich für die Datenverarbeitung auf dieser Website ist:
              <br />
              {l.company}, {l.owner}
              <br />
              {l.street}, {l.city}, {l.country}
              <br />
              E-Mail: {l.email}
              <br />
              Telefon: {l.phone}
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">2. Überblick</h2>
            <p className="mt-3">
              Wir nehmen den Schutz Ihrer personenbezogenen Daten ernst und
              verarbeiten diese ausschließlich auf Grundlage der gesetzlichen
              Bestimmungen (DSGVO, BDSG, TDDDG). Diese Datenschutzerklärung
              informiert Sie darüber, welche Daten wir beim Besuch dieser Website
              verarbeiten, zu welchem Zweck und auf welcher Rechtsgrundlage.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              3. Ihre Rechte als betroffene Person
            </h2>
            <p className="mt-3">
              Ihnen stehen gegenüber uns folgende Rechte hinsichtlich der Sie
              betreffenden personenbezogenen Daten zu:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>Recht auf Auskunft (Art. 15 DSGVO)</li>
              <li>Recht auf Berichtigung (Art. 16 DSGVO)</li>
              <li>Recht auf Löschung (Art. 17 DSGVO)</li>
              <li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
              <li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</li>
              <li>Recht auf Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)</li>
              <li>
                Recht auf Widerruf einer erteilten Einwilligung mit Wirkung für
                die Zukunft (Art. 7 Abs. 3 DSGVO)
              </li>
            </ul>
            <p className="mt-3">
              Zur Ausübung wenden Sie sich an {l.email}. Unabhängig davon haben
              Sie das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu
              beschweren (Art. 77 DSGVO). Zuständig ist u. a. der Landesbeauftragte
              für den Datenschutz und die Informationsfreiheit Rheinland-Pfalz.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              4. Hosting (Vercel)
            </h2>
            <p className="mt-3">
              Diese Website wird bei der Vercel Inc. (340 S Lemon Ave #4133,
              Walnut, CA 91789, USA) gehostet. Beim Aufruf der Seite verarbeitet
              der Anbieter technisch notwendige Daten (u. a. Ihre IP-Adresse), um
              die Inhalte sicher und zuverlässig auszuliefern. Rechtsgrundlage ist
              unser berechtigtes Interesse an einem sicheren und effizienten
              Betrieb der Website (Art. 6 Abs. 1 lit. f DSGVO). Mit dem Anbieter
              besteht ein Auftragsverarbeitungsvertrag. Eine Übermittlung in die
              USA erfolgt auf Grundlage von Standardvertragsklauseln bzw. des
              EU-US Data Privacy Framework.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">5. Server-Logfiles</h2>
            <p className="mt-3">
              Beim Besuch der Website werden automatisch Informationen in
              sogenannten Server-Logfiles erfasst, die Ihr Browser übermittelt:
              IP-Adresse, Datum und Uhrzeit der Anfrage, aufgerufene Seite,
              Referrer-URL sowie Browsertyp und Betriebssystem. Diese Daten dienen
              dem technischen Betrieb, der Sicherheit und der Fehleranalyse, werden
              nicht mit anderen Datenquellen zusammengeführt und nach kurzer Zeit
              gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              6. SSL-/TLS-Verschlüsselung
            </h2>
            <p className="mt-3">
              Diese Website nutzt aus Sicherheitsgründen eine SSL-/TLS-
              Verschlüsselung. Eine verschlüsselte Verbindung erkennen Sie am
              „https://" in der Adresszeile Ihres Browsers.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              7. Kontaktformular (Formspree)
            </h2>
            <p className="mt-3">
              Wenn Sie uns über das Kontaktformular kontaktieren, werden die von
              Ihnen eingegebenen Daten (Name, E-Mail-Adresse und Nachricht) zur
              Bearbeitung Ihrer Anfrage verarbeitet. Der Versand erfolgt über den
              Dienstleister Formspree (Formspree, Inc., USA), der die Daten in
              unserem Auftrag verarbeitet und an uns weiterleitet. Mit dem Anbieter
              besteht ein Auftragsverarbeitungsvertrag; die Übermittlung in die USA
              erfolgt auf Grundlage von Standardvertragsklauseln bzw. des EU-US
              Data Privacy Framework. Rechtsgrundlage ist Ihre Einwilligung
              (Art. 6 Abs. 1 lit. a DSGVO) sowie unser berechtigtes Interesse an
              der Beantwortung Ihrer Anfrage (Art. 6 Abs. 1 lit. f DSGVO); bezieht
              sich die Anfrage auf einen Vertrag, zusätzlich Art. 6 Abs. 1 lit. b
              DSGVO. Wir speichern die Daten, bis Ihre Anfrage abschließend
              bearbeitet ist, sofern keine gesetzlichen Aufbewahrungspflichten
              entgegenstehen. Sie können der Speicherung jederzeit widersprechen.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">8. Schriftarten</h2>
            <p className="mt-3">
              Diese Website verwendet lokal auf unserem Server bereitgestellte
              Schriftarten. Beim Laden der Schriften wird keine Verbindung zu
              Google oder anderen Dritten aufgebaut und es werden keine Daten an
              Dritte übertragen.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              9. Interaktive 3D-Ansicht und lokale Speicherung
            </h2>
            <p className="mt-3">
              Auf dieser Website ist eine interaktive 3D-Ansicht eingebunden, die
              von unserer eigenen Domain ausgeliefert wird. Um Ihre Anzeige- und
              Bedieneinstellungen zu speichern, können technisch notwendige
              Informationen lokal in Ihrem Browser abgelegt werden (localStorage).
              Wir setzen keine Tracking- oder Werbe-Cookies ein und verwenden keine
              Analyse- oder Reichweitenmessungs-Dienste. Rechtsgrundlage ist § 25
              Abs. 2 TDDDG sowie Art. 6 Abs. 1 lit. f DSGVO.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              10. Datenübermittlung in Drittländer
            </h2>
            <p className="mt-3">
              Einzelne der vorgenannten Dienstleister (Vercel, Formspree) haben
              ihren Sitz in den USA. Soweit dabei personenbezogene Daten in die USA
              übermittelt werden, erfolgt dies auf Grundlage von
              Standardvertragsklauseln bzw. des EU-US Data Privacy Framework. Es
              kann nicht vollständig ausgeschlossen werden, dass das Datenschutz-
              niveau in Drittländern nicht in allen Punkten dem der EU entspricht.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">11. Speicherdauer</h2>
            <p className="mt-3">
              Sofern in dieser Erklärung keine speziellere Speicherdauer genannt
              ist, verbleiben Ihre personenbezogenen Daten bei uns, bis der Zweck
              der Verarbeitung entfällt. Bestehen gesetzliche Aufbewahrungs-
              pflichten, werden die Daten bis zu deren Ablauf aufbewahrt und danach
              gelöscht.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              12. Änderungen dieser Datenschutzerklärung
            </h2>
            <p className="mt-3">
              Wir passen diese Datenschutzerklärung an, sobald Änderungen der von
              uns eingesetzten Dienste oder der Rechtslage dies erforderlich
              machen. Es gilt jeweils die hier veröffentlichte aktuelle Fassung.
            </p>
          </section>

          <p className="border-t border-mist pt-6 text-[13px] text-smoke">
            Stand: Juni 2026
          </p>
        </div>
      </main>
    </div>
  );
}
