import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Datenschutz",
  robots: { index: false, follow: true },
};

// Privacy policy tailored to the services ACTUALLY in use, verified against the
// codebase (2026-07): Vercel hosting, self-hosted fonts, the same-domain 3D
// viewer + localStorage, plus the viewer backend on Cloudflare Workers/D1/KV/R2
// (reach analytics, KI concierge via Anthropic, virtual staging via Google
// Gemini/fal, geo services, viewer lead form) and the website contact form
// (Formspree + GoHighLevel CRM). Verantwortlicher comes from config.legal.
// If services change, add/adjust the matching section. Still requires a legal
// review before relying on it (AV-Verträge / DPF-Status / Löschfristen).
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
              Verantwortlich für die Datenverarbeitung auf dieser Website und im
              eingebetteten 3D-Viewer ist:
              <br />
              {l.company}, {l.owner}
              <br />
              {l.street}, {l.city}, {l.country}
              <br />
              E-Mail: {l.email}
              <br />
              Telefon: {l.phone}
            </p>
            <p className="mt-3">
              Einen Datenschutzbeauftragten haben wir nicht bestellt.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">2. Überblick</h2>
            <p className="mt-3">
              Wir nehmen den Schutz Ihrer personenbezogenen Daten ernst und
              verarbeiten diese ausschließlich auf Grundlage der gesetzlichen
              Bestimmungen (DSGVO, BDSG, TDDDG). Diese Datenschutzerklärung
              informiert Sie darüber, welche Daten wir beim Besuch dieser Website
              und bei Nutzung der interaktiven 3D-Immobilienansicht („Viewer")
              verarbeiten, zu welchem Zweck, auf welcher Rechtsgrundlage und an
              welche Dienstleister diese weitergegeben werden.
            </p>
            <p className="mt-3">
              Ein Teil der nachstehend beschriebenen Funktionen (u. a.
              Reichweitenmessung, KI-Concierge, Anfrageformular im Viewer,
              Umgebungskarte, virtuelles Möblieren) wird erst aktiv, wenn Sie den
              Viewer öffnen bzw. die jeweilige Funktion nutzen. Mehrere dieser
              Funktionen übermitteln Daten an Dienstleister mit Sitz in den USA
              (siehe Abschnitt „Datenübermittlung in Drittländer").
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
              <strong className="font-semibold text-ink">
                Widerspruchsrecht (Art. 21 DSGVO):
              </strong>{" "}
              Soweit wir Daten auf Grundlage unseres berechtigten Interesses
              (Art. 6 Abs. 1 lit. f DSGVO) verarbeiten – etwa im Rahmen der
              Reichweitenmessung –, haben Sie das Recht, aus Gründen, die sich aus
              Ihrer besonderen Situation ergeben, jederzeit Widerspruch
              einzulegen.
            </p>
            <p className="mt-3">
              Zur Ausübung Ihrer Rechte wenden Sie sich an {l.email}. Unabhängig
              davon haben Sie das Recht, sich bei einer
              Datenschutz-Aufsichtsbehörde zu beschweren (Art. 77 DSGVO).
              Zuständig ist u. a. der Landesbeauftragte für den Datenschutz und
              die Informationsfreiheit Rheinland-Pfalz.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              4. Hosting der Website und des Viewers (Vercel)
            </h2>
            <p className="mt-3">
              Diese Website und der von derselben Domain ausgelieferte 3D-Viewer
              werden bei der Vercel Inc. (340 S Lemon Ave #4133, Walnut, CA 91789,
              USA) gehostet. Beim Aufruf verarbeitet der Anbieter technisch
              notwendige Daten (u. a. Ihre IP-Adresse, Request-Metadaten,
              Server-Logfiles). Auf Vercel läuft zusätzlich eine serverseitige
              Funktion, die Kontaktanfragen des Website-Formulars an unser CRM
              weiterleitet (siehe Abschnitt „Kontaktformular der Website").
              Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren
              und effizienten Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Mit dem
              Anbieter besteht ein Auftragsverarbeitungsvertrag nach Art. 28
              DSGVO. Die Übermittlung in die USA erfolgt auf Grundlage von
              Standardvertragsklauseln bzw. des EU-US Data Privacy Framework.
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
            <h2 className="text-[20px] font-bold text-ink">7. Schriftarten</h2>
            <p className="mt-3">
              Diese Website verwendet lokal auf unserem Server bereitgestellte
              Schriftarten. Beim Laden der Schriften wird keine Verbindung zu
              Google oder anderen Dritten aufgebaut und es werden keine Daten an
              Dritte übertragen.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              8. Interaktive 3D-Ansicht und lokale Speicherung
            </h2>
            <p className="mt-3">
              Auf dieser Website ist eine interaktive 3D-Ansicht
              (Gaussian-Splatting-Rundgang) eingebunden, die von unserer eigenen
              Domain ausgeliefert wird. Um Ihre Anzeige- und Bedieneinstellungen
              zu speichern, können technisch notwendige Informationen lokal in
              Ihrem Browser abgelegt werden (localStorage). Rechtsgrundlage für
              diese Speicherung ist § 25 Abs. 2 TDDDG (technisch erforderlich)
              sowie Art. 6 Abs. 1 lit. f DSGVO.
            </p>
            <p className="mt-3">
              Der Viewer bietet darüber hinaus optionale Funktionen
              (Reichweitenmessung, KI-Concierge, Anfrageformular, Umgebungskarte,
              virtuelles Möblieren), die – teils erst bei Nutzung – Daten an die in
              den folgenden Abschnitten genannten Dienstleister übermitteln.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              9. Reichweitenmessung / Nutzungsanalyse (Cloudflare)
            </h2>
            <p className="mt-3">
              Beim Öffnen des Viewers und während der Nutzung erheben wir zur
              Reichweitenmessung und zur Verbesserung unseres Angebots pseudonyme
              Nutzungsereignisse. Erfasst werden insbesondere:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>
                ein zufällig erzeugter, sitzungsbezogener Kennwert (Session-ID;
                kein dauerhafter Personenbezug, keine Cookie-basierte
                Wiedererkennung),
              </li>
              <li>
                das Öffnen der Tour, die Verweildauer (über periodische
                „Heartbeat"-Signale, ca. alle 30 Sekunden) sowie die Nutzung
                einzelner Funktionen (z. B. Rundgang, Luftaufnahmen, Anmerkungen,
                virtuelles Möblieren, Teilen, Umgebungskarte, Umfrage, Klick auf
                Handlungsaufforderungen),
              </li>
              <li>
                die Zugriffsquelle (utm_source-Parameter bzw. Hostname der
                verweisenden Seite),
              </li>
              <li>ein serverseitiger Zeitstempel.</li>
            </ul>
            <p className="mt-3">
              Die Ereignisse werden an einen von der Cloudflare, Inc. (101
              Townsend Street, San Francisco, CA 94107, USA) betriebenen Dienst
              gesendet und in einer Cloudflare-Datenbank (D1) gespeichert. Ihre
              IP-Adresse wird beim Empfang nicht an die Analyse-Funktion
              weitergegeben und dort nicht gespeichert; sie wird ausschließlich
              kurzzeitig (wenige Minuten) in einem flüchtigen Zähler zur Missbrauchs-
              und Ratenbegrenzung verarbeitet und anschließend automatisch
              gelöscht.
            </p>
            <p className="mt-3">
              <strong className="font-semibold text-ink">Speicherdauer:</strong>{" "}
              Die Ereignisse werden automatisiert nach 90 Tagen gelöscht
              (nächtlicher Löschlauf). Aus den Daten wird ein aggregierter
              Nutzungs-/Reichweiten-Report für den jeweiligen Objekt-/Maklerzugang
              erstellt.
            </p>
            <p className="mt-3">
              <strong className="font-semibold text-ink">Rechtsgrundlage:</strong>{" "}
              berechtigtes Interesse an einer pseudonymen Reichweiten- und
              Nutzungsmessung (Art. 6 Abs. 1 lit. f DSGVO). Sie können dieser
              Verarbeitung nach Art. 21 DSGVO widersprechen (Kontakt siehe
              Abschnitt 3). Die Übermittlung in die USA erfolgt auf Grundlage von
              Standardvertragsklauseln bzw. des EU-US Data Privacy Framework.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              10. KI-Concierge (Anthropic / Cloudflare)
            </h2>
            <p className="mt-3">
              Der Viewer kann einen KI-gestützten Concierge anbieten, der frei
              formulierte Fragen zur Immobilie beantwortet. Wenn Sie diese
              Funktion nutzen und eine Frage absenden, werden der von Ihnen
              eingegebene Fragetext im Wortlaut, der bisherige Gesprächsverlauf der
              Sitzung, der aktuelle Raum-Kontext und ggf. eine von Ihnen
              eingegebene Ortssuche-Anfrage verarbeitet.
            </p>
            <p className="mt-3">
              Diese Freitexteingaben{" "}
              <strong className="font-semibold text-ink">
                können personenbezogene Angaben enthalten
              </strong>
              , wenn Sie solche eingeben; sie sind daher nicht als anonym
              anzusehen. Wir bitten Sie, keine sensiblen personenbezogenen Daten in
              den Chat einzugeben.
            </p>
            <p className="mt-3">
              <strong className="font-semibold text-ink">
                Übermittlung / Verarbeitung:
              </strong>{" "}
              Die Anfrage wird serverseitig über den Cloudflare-Dienst an die
              Anthropic PBC (548 Market Street, PMB 90375, San Francisco, CA 94104,
              USA) übermittelt und dort durch ein Sprachmodell (Claude)
              verarbeitet. Ihre IP-Adresse wird dabei nicht an Anthropic
              übermittelt. Bei einer Ortssuche kann eine zusätzliche Verarbeitung
              über Geo-Dienste erfolgen (siehe Abschnitt „Umgebungskarte /
              Geo-Dienste").
            </p>
            <p className="mt-3">
              <strong className="font-semibold text-ink">Speicherung:</strong> Der
              Fragetext wird zusätzlich – auf 300 Zeichen gekürzt – als
              Nutzungsereignis in der Cloudflare-Datenbank gespeichert und dort
              nach 90 Tagen gelöscht (vgl. Abschnitt 9). Dieser Text kann in dem
              für den Objekt-/Maklerzugang erstellten Report im Wortlaut angezeigt
              werden.
            </p>
            <p className="mt-3">
              <strong className="font-semibold text-ink">Rechtsgrundlage:</strong>{" "}
              Art. 6 Abs. 1 lit. f DSGVO (Bereitstellung einer interaktiven
              Auskunftsfunktion) bzw., soweit Ihre Anfrage der Anbahnung eines
              Vertrages dient, Art. 6 Abs. 1 lit. b DSGVO. Die Übermittlung in die
              USA erfolgt auf Grundlage von Standardvertragsklauseln bzw. des EU-US
              Data Privacy Framework.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              11. Virtuelles Möblieren (Bild-KI)
            </h2>
            <p className="mt-3">
              Der Viewer kann eine Funktion zum virtuellen Möblieren („Möbliert
              sehen") anbieten. Dabei wird ein aus der 3D-Szene erzeugtes Standbild
              des (leeren) Raums zusammen mit einer Stilauswahl serverseitig an
              einen Bild-KI-Dienst übermittelt und ein möbliertes Ergebnisbild
              zurückgegeben. Verarbeitet wird das gerenderte Raum-Standbild sowie
              Referenz-/Stilbilder; ein Personenbezug zum Besucher entsteht hierbei
              regelmäßig nicht (es werden keine Kontakt- oder Nutzerdaten
              übermittelt). Als Bild-KI-Dienst kommt Google Gemini (Google LLC,
              1600 Amphitheatre Parkway, Mountain View, CA 94043, USA) bzw.
              alternativ fal.ai (fal, USA) zum Einsatz. Wird die Funktion im
              „Demo"-Modus betrieben, werden vorab gerenderte Bilder angezeigt und
              es wird kein Bild an den externen Dienst gesendet. Rechtsgrundlage ist
              Art. 6 Abs. 1 lit. f DSGVO; eine etwaige Übermittlung in die USA
              erfolgt auf Grundlage von Standardvertragsklauseln bzw. des EU-US
              Data Privacy Framework.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              12. Umgebungskarte / Geo-Dienste
            </h2>
            <p className="mt-3">
              Öffnen Sie im Viewer die Umgebungs-/Nachbarschaftskarte oder nutzen
              Sie eine Adress-/Ortssuche oder Routenberechnung, werden – teils
              direkt aus Ihrem Browser – Anfragen an externe Geo-Dienste gesendet.
              Dabei kann Ihre IP-Adresse an diese Dienste übermittelt werden; bei
              der Adresssuche wird zusätzlich der von Ihnen eingegebene Suchtext
              übertragen. Innerhalb der Reichweitenmessung werden nur die Aktionen
              erfasst – nicht der eingegebene Adresstext.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>
                <strong className="font-semibold text-ink">
                  Kartenkacheln/Style:
                </strong>{" "}
                MapTiler AG (Höfnerstrasse 30, 6314 Unterägeri, Schweiz).
              </li>
              <li>
                <strong className="font-semibold text-ink">
                  Adress-Geocoding:
                </strong>{" "}
                Photon / komoot GmbH (photon.komoot.io) – auch serverseitig durch
                den KI-Concierge bei einer Ortssuche.
              </li>
              <li>
                <strong className="font-semibold text-ink">Routing:</strong> OSRM,
                betrieben durch FOSSGIS e. V. (routing.openstreetmap.de) – auch
                serverseitig durch den Concierge.
              </li>
              <li>
                <strong className="font-semibold text-ink">ÖPNV-Routing:</strong>{" "}
                Transitous (api.transitous.org).
              </li>
              <li>
                <strong className="font-semibold text-ink">
                  Umkreis-/Kategoriesuche (serverseitig):
                </strong>{" "}
                Overpass API (overpass-api.de) – hierbei wird Ihre IP-Adresse nicht
                weitergereicht.
              </li>
            </ul>
            <p className="mt-3">
              Die serverseitig (über den Concierge) ausgelösten Geo-Anfragen
              erfolgen ohne Übermittlung Ihrer IP-Adresse; die im Browser
              ausgelösten Karten-/Such-/Routing-Anfragen enthalten Ihre IP-Adresse.
              Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO bzw. § 25 Abs. 1
              TDDDG, soweit für den Abruf externer Karteninhalte eine Einwilligung
              erforderlich ist. Die genannten Dienste haben ihren Sitz überwiegend
              in der EU bzw. in der Schweiz.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              13. Kontaktformular der Website (Formspree, GoHighLevel)
            </h2>
            <p className="mt-3">
              Wenn Sie uns über das Kontaktformular der Website kontaktieren,
              werden die von Ihnen eingegebenen Daten (Name, E-Mail-Adresse und
              Nachricht) zur Bearbeitung Ihrer Anfrage verarbeitet und auf zwei
              Wegen weitergeleitet: per E-Mail-Zustelldienst über Formspree, Inc.
              (2100 Geng Road, Suite 210, Palo Alto, CA 94303, USA) sowie
              zusätzlich serverseitig an unser CRM GoHighLevel / LeadConnector
              (HighLevel Inc., USA) zur zeitnahen Nachverfolgung. Das Absenden
              setzt Ihre ausdrückliche Einwilligung voraus (Bestätigungsfeld am
              Formular). Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1
              lit. a DSGVO) sowie unser berechtigtes Interesse an der Beantwortung
              Ihrer Anfrage (Art. 6 Abs. 1 lit. f DSGVO); bezieht sich die Anfrage
              auf einen Vertrag, zusätzlich Art. 6 Abs. 1 lit. b DSGVO. Sie können
              Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen.
              Mit den Anbietern bestehen Auftragsverarbeitungsverträge nach Art. 28
              DSGVO; die Übermittlung in die USA erfolgt auf Grundlage von
              Standardvertragsklauseln bzw. des EU-US Data Privacy Framework. Wir
              speichern die Daten, bis Ihre Anfrage abschließend bearbeitet ist,
              sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              14. Anfrage-/Besichtigungsformular im Viewer
            </h2>
            <p className="mt-3">
              Der Viewer enthält ein Anfrage-/Besichtigungsformular. Wenn Sie
              dieses absenden, verarbeiten wir die von Ihnen eingegebenen Daten:
              Name, Kontaktdaten (E-Mail-Adresse oder Telefonnummer), Nachricht,
              Interesse, gewünschter Einzugs-/Zeitrahmen sowie ein
              Einwilligungskennzeichen; zusätzlich ein serverseitiger Zeitstempel
              und die Zuordnung zum jeweiligen Objekt. Das Absenden setzt Ihre
              ausdrückliche Einwilligung voraus (das Formular erfordert eine aktive
              Zustimmung).
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>
                Die Daten werden in der Cloudflare-Datenbank gespeichert. Diese
                Lead-Datensätze werden – anders als die Reichweitenmess-Ereignisse
                – nicht automatisch nach 90 Tagen gelöscht, sondern als
                Geschäftsvorgang aufbewahrt.
              </li>
              <li>
                Nach dem Speichern kann die Anfrage automatisiert an das CRM
                GoHighLevel / LeadConnector (HighLevel Inc., USA) weitergeleitet
                werden, damit der zuständige Anbieter/Makler Sie kontaktieren kann.
              </li>
              <li>
                Der jeweilige Eigentümer/Makler kann die zu seinem Objekt
                gehörenden Anfragen über einen zugangsgeschützten Report abrufen.
              </li>
            </ul>
            <p className="mt-3">
              <strong className="font-semibold text-ink">Rechtsgrundlage:</strong>{" "}
              Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) sowie – zur Anbahnung/
              Durchführung eines Miet-/Kaufvorgangs – Art. 6 Abs. 1 lit. b DSGVO.
              Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft
              widerrufen (Kontakt siehe Abschnitt 3). Die Übermittlung in die USA
              (Cloudflare, GoHighLevel) erfolgt auf Grundlage von
              Standardvertragsklauseln bzw. des EU-US Data Privacy Framework.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              15. Backend-Infrastruktur (Cloudflare)
            </h2>
            <p className="mt-3">
              Die Funktionen Reichweitenmessung, KI-Concierge, virtuelles
              Möblieren, Ortssuche und Lead-Erfassung werden über eine bei der
              Cloudflare, Inc. (San Francisco, CA, USA) betriebene
              Backend-Anwendung bereitgestellt. Cloudflare verarbeitet dabei als
              Auftragsverarbeiter Nutzungs-/Reichweitenmess-Ereignisse und
              Concierge-Fragen (Löschung nach 90 Tagen), Lead-/Anfragedaten
              (Aufbewahrung als Geschäftsvorgang) sowie Zähler zur
              Raten-/Missbrauchsbegrenzung (hierfür wird Ihre IP-Adresse nur
              kurzzeitig verwendet und automatisch gelöscht). Rechtsgrundlage ist
              Art. 6 Abs. 1 lit. f DSGVO sowie, soweit einschlägig, Art. 6 Abs. 1
              lit. a und lit. b DSGVO für die jeweils darüber abgewickelten
              Funktionen. Mit Cloudflare besteht ein Auftragsverarbeitungsvertrag
              nach Art. 28 DSGVO. Die Übermittlung in die USA erfolgt auf Grundlage
              von Standardvertragsklauseln bzw. des EU-US Data Privacy Framework.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              16. Datenübermittlung in Drittländer
            </h2>
            <p className="mt-3">
              Ein Teil der von uns eingesetzten Dienstleister hat seinen Sitz in
              den USA, insbesondere: Vercel (Hosting), Cloudflare (Backend,
              Datenbank, Reichweitenmessung, Lead-Speicher), Anthropic
              (KI-Concierge), Google und ggf. fal.ai (Bild-KI), Formspree
              (Kontaktformular) und GoHighLevel/LeadConnector (CRM). Soweit dabei
              personenbezogene Daten in die USA übermittelt werden, erfolgt dies
              auf Grundlage von Standardvertragsklauseln (Art. 46 DSGVO) bzw. –
              soweit die Anbieter zertifiziert sind – des EU-US Data Privacy
              Framework. Weitere Dienste (MapTiler, Photon/komoot, OSRM/FOSSGIS,
              Overpass, Transitous) haben ihren Sitz in der EU bzw. der Schweiz. Es
              kann nicht vollständig ausgeschlossen werden, dass das
              Datenschutzniveau in Drittländern nicht in allen Punkten dem der EU
              entspricht.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">17. Speicherdauer</h2>
            <p className="mt-3">
              Sofern in dieser Erklärung keine speziellere Speicherdauer genannt
              ist, verbleiben Ihre personenbezogenen Daten bei uns, bis der Zweck
              der Verarbeitung entfällt. Im Einzelnen: Reichweitenmess-Ereignisse
              und Concierge-Fragen werden nach 90 Tagen automatisiert gelöscht;
              Lead-/Anfragedaten aus dem Viewer werden als Geschäftsvorgang
              aufbewahrt und gelöscht, sobald der Zweck entfällt und keine
              gesetzlichen Aufbewahrungspflichten entgegenstehen; Kontaktanfragen
              der Website bis zur abschließenden Bearbeitung; Server-Logfiles
              kurzfristig. Bestehen gesetzliche Aufbewahrungspflichten, werden die
              Daten bis zu deren Ablauf aufbewahrt und danach gelöscht.
            </p>
          </section>

          <section>
            <h2 className="text-[20px] font-bold text-ink">
              18. Änderungen dieser Datenschutzerklärung
            </h2>
            <p className="mt-3">
              Wir passen diese Datenschutzerklärung an, sobald Änderungen der von
              uns eingesetzten Dienste oder der Rechtslage dies erforderlich
              machen. Es gilt jeweils die hier veröffentlichte aktuelle Fassung.
            </p>
          </section>

          <p className="border-t border-mist pt-6 text-[13px] text-smoke">
            Stand: Juli 2026
          </p>
        </div>
      </main>
    </div>
  );
}
