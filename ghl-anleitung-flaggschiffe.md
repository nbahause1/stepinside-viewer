# GHL-Anleitung: Monats-Report (1.2 + 1.3) & Hot-Lead-Alarm (2.2)

Stand: 14.07.2026 · Beide Workflows in GHL bauen, dann **publishen** (nicht als Draft liegen lassen).
Die fertigen Mail-HTMLs liegen im Repo-Root: `report-email.html` und `hotlead-alarm-email.html`
(in GHL als Custom-HTML-E-Mail einfügen: E-Mail-Baustein → Code-Ansicht → HTML komplett reinkopieren).

---

## A. Custom Field anlegen (Schritt 1.2, einmalig)

1. GHL → Settings → **Custom Fields** → Add Field → Typ **Text**.
   - *Wofür:* Jeder Makler-Kontakt bekommt seinen privaten Report-Link als Feld am Kontakt.
   - *Technik:* Die Report-Mail liest das Feld per Merge-Tag `{{contact.report_url}}` aus.
2. Name: `report_url` (Gruppe: Contact). Speichern.
3. Beim Makler-Kontakt den Wert eintragen: den Link, den `scripts/register-property.mjs` ausgibt
   (Form: `https://concierge-api.stepinside-eu.workers.dev/report/<property-id>?token=<64 Hex-Zeichen>`).

---

## B. Workflow "Monats-Report" (Schritt 1.3)

1. Automation → Create Workflow → Start from Scratch, Name: **Monats-Report**.
2. Trigger: **Contact Tag Added**, Tag = `kunde:aktiv`.
   - *Wofür:* Der Report-Rhythmus startet in dem Moment, in dem du einen Kunden aktiv schaltest.
   - *Technik:* Tag setzen = Abo an, Tag entfernen + "Remove from Workflow" = Abo aus.
3. Aktion 1: **Send Email**.
   - Betreff: `Ihr Rundgang hat gearbeitet`
   - Inhalt: HTML aus `report-email.html` (Code-Ansicht).
4. Aktion 2: **Wait** → 30 Days.
5. Aktion 3: **Go To** → zurück auf Aktion 1 (Send Email).
   - *Wofür:* Die Monatsschleife — eine Mail, 30 Tage warten, wieder von vorn.
   - *Technik:* GHL hat keinen echten Loop-Baustein; Wait + Go To ist das offizielle Schleifen-Muster.
6. Workflow-Settings: **Allow Re-Entry / Re-Enrollment = OFF**.
   - *Wofür:* Verhindert doppelte Schleifen, falls der Tag versehentlich zweimal gesetzt wird.
7. **Publish**.

**Kündigungs-Ablauf:** Tag `kunde:aktiv` am Kontakt entfernen UND Kontakt manuell aus dem
Workflow nehmen (Contact → Actions → Remove from Workflow). Die Schleife endet sofort.

---

## C. Workflow "Hot-Lead-Alarm" (Schritt 2.2)

1. Automation → Create Workflow → Start from Scratch, Name: **Hot-Lead-Alarm**.
2. Trigger: **Inbound Webhook** hinzufügen.
   - GHL zeigt dir eine **Webhook-URL** an → kopieren, die brauchen wir gleich zweimal.
   - *Wofür:* Diese URL ist der Briefkasten, in den der Viewer-Server jeden neuen Lead wirft.
   - *Technik:* Der Cloudflare-Worker POSTet nach jedem gespeicherten Lead ein JSON dorthin
     (fire-and-forget: fällt GHL aus, funktionieren Viewer und Lead-Speicherung trotzdem weiter).
3. **Mapping einlernen:** Während der Trigger-Editor offen ist und auf einen Test wartet,
   im Terminal den Test-Payload an die kopierte URL schicken (URL einsetzen):

   ```bash
   curl -X POST "<DEINE-GHL-WEBHOOK-URL>" \
     -H "Content-Type: application/json" \
     -d '{
       "signal": "lead",
       "propertyId": "demo-altbau",
       "propertyLabel": "Altbau-Etage Eppendorf",
       "ownerEmail": "makler@example.com",
       "leadName": "Max Mustermann",
       "leadContact": "max@example.com · 0170 1234567",
       "leadMessage": "Ich möchte die Wohnung gerne am Wochenende besichtigen.",
       "leadInterest": "Besichtigung",
       "leadTimeframe": "In 1 bis 3 Monaten"
     }'
   ```

   - *Wofür:* GHL lernt aus diesem Beispiel die Feldnamen und bietet sie danach als Merge-Tags an.
   - *Technik:* Exakt dieses JSON-Format sendet der Worker in Produktion (analytics.ts, forwardHotLead).
4. Aktion 1: **Find / Create Contact** — Suchfeld E-Mail = Webhook-Feld `ownerEmail`.
   - *Wofür:* Der Alarm soll an den Makler des Objekts gehen, nicht an den Interessenten.
   - *Technik:* `ownerEmail` kommt aus der properties-Tabelle (Spalte owner_email, Migration 0003).
5. Aktion 2: **Send Email** an diesen Kontakt.
   - Betreff: `Neue Anfrage zu {{inboundWebhookRequest.propertyLabel}}`
   - Inhalt: HTML aus `hotlead-alarm-email.html`.
   - Falls deine GHL-Version die Felder anders benennt (Merge-Field-Picker prüfen!), die
     `{{inboundWebhookRequest.*}}`-Tags im HTML entsprechend ersetzen.
6. Aktion 3: **Internal Notification** (E-Mail an dich) — Kopie des Alarms, gleiche Felder.
   - *Wofür:* Du siehst jeden Alarm mit und kannst beim Makler nachfassen ("Und, angerufen?").
7. **Publish**.

---

## D. Webhook-URL im Worker hinterlegen (nach C, einmalig)

```bash
cd apps/concierge-api
npx wrangler secret put GHL_HOTLEAD_WEBHOOK_URL   # GHL-Webhook-URL aus Schritt C.2 einfügen
```

- *Wofür:* Erst mit diesem Secret beginnt der Worker, Leads an GHL weiterzuleiten.
- *Technik:* Secret statt Klartext-Var, weil die URL das Zugriffs-Token enthält. Ohne das
  Secret ist die Weiterleitung ein No-Op — speichern tut der Worker Leads trotzdem immer.

## E. End-to-End-Probe (nach allem)

1. Im Viewer (myinnsyn.de oder localhost) das Anfrage-Formular absenden.
2. Erwartung: Lead in D1 gespeichert UND Alarm-Mail beim Makler-Kontakt + Notification bei dir.
3. Gegenprobe im Terminal: `npx wrangler d1 execute innsyn-analytics --remote --json --command "SELECT * FROM leads ORDER BY id DESC LIMIT 3"`
