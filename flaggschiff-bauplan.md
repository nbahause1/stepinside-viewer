# Bauplan: Flaggschiff 1 (Engagement-Report) & Flaggschiff 2 (Hot-Lead-Alarm)

Stand: 13.07.2026 · Beide Flaggschiffe teilen sich ein Fundament.
Das Schwerste ist bereits gebaut: Der Viewer misst alles (apps/viewer/src/analytics.ts),
der Report ist fertig programmiert (apps/concierge-api/src/report.ts, innsyn-Branding).
Was fehlt, ist Aktivierung und Verdrahtung.

**Legende:** `DU` = Hauke klickt/führt aus · `ICH` = Claude liefert Code/Skripte/Texte

---

## Teil 0: Fundament (Voraussetzung für beide Flaggschiffe)

**Wofür:** Die Daten-Maschine einschalten. Der Viewer sammelt heute ins Leere,
weil die D1-Datenbank nicht angebunden ist (auskommentiert in wrangler.toml).

- [x] **0.1 Cloudflare-Account klären** · `DU` · ~~DER einzige Blocker~~ **ENTSCHIEDEN 14.07.**
  - Finaler Account: **haukecux19@gmail.com** (Account-ID 78f5f61b…, Subdomain
    `stepinside-eu.workers.dev`). Der zweite Account (`stepinside.workers.dev`) ist verwaist.
  - *Korrektur zur Annahme "sammelt ins Leere":* Der Viewer schickte Events bislang an den
    ALTEN Worker im zweiten Account (der dort eine eigene D1 hat). Evtl. liegen dort schon
    Daten — nur über den Login des zweiten Accounts einsehbar, nicht kritisch.

- [x] **0.2 Config vorbereiten** · `ICH` · erledigt 14.07.
  - D1-Block einkommentiert: `innsyn-analytics`, database_id `5a990b1f-3e10-4a67-8718-444ffcaa0ef9`.
  - ALLOWED_ORIGINS um `https://myinnsyn.de` + `https://www.myinnsyn.de` ergänzt.
  - *Technik:* Ohne Origin-Eintrag blockt CORS alle Viewer-Events von der neuen Domain.

- [ ] **0.3 Datenbank anlegen + Worker deployen** · fast fertig — **nur noch 1 Befehl für DICH**
  - [x] `wrangler d1 create innsyn-analytics` — von ICH ausgeführt (wrangler war eingeloggt)
  - [x] `wrangler d1 migrations apply innsyn-analytics --remote` — beide Migrationen ✅
  - [ ] **Deploy** (Berechtigungs-Schranke: Produktions-Deploy führst DU aus):
  ```bash
  cd apps/concierge-api && npx wrangler deploy
  ```
  - *Technik:* D1 = Cloudflares SQLite-Datenbank. Die Tabellen (events, leads, properties)
    existieren bereits. Der Deploy bindet die DB an den Worker → /events, /lead, /report live.

- [x] **0.4 Viewer scharfstellen** · `ICH` · erledigt 14.07.
  - analytics- UND stage-Endpoint in settings.json von `stepinside.workers.dev` (alter
    Account!) auf `stepinside-eu.workers.dev` umgebogen; propertyId bleibt `demo-altbau`.
  - `npm run sync:viewer` gelaufen. Website-Deploy steht noch aus (hängt am
    unge­pushten Branch `feat/speed-to-lead-webhook`, siehe Nebenpunkte).
  - *Technik:* Ohne diese zwei Werte ist das Analytics-Modul ein bewusster No-Op.

- [ ] **0.5 End-to-End verifizieren** · `ICH` · direkt nach deinem Deploy
  - `GET /healthz` → muss `d1: true, kv: true` melden.
  - Test-Events senden, per `wrangler d1 execute` prüfen, dass sie in der DB liegen.

*Aufwand: ein Nachmittag, davon DU ca. 15 Minuten.*

---

## Teil 1: Flaggschiff 1 — Monats-Report an Makler-Kunden

**Wofür:** Jeden Monat automatisch der Beweis, dass der Rundgang arbeitet
("Ihr Rundgang wurde 143× geöffnet, Ø 4:20 min"). Sichert das Hosting-Abo,
macht Kündigen emotional schwer, bestes Argument im Verkaufsgespräch.

- [x] **1.1 Objekt registrieren** · erledigt 14.07.: Skript `apps/concierge-api/scripts/register-property.mjs`,
  demo-altbau registriert (owner haukecux19@gmail.com), Report-Link verifiziert
  (200 mit Token, 404 ohne/falsch; KPIs + Lead-Tabelle rendern korrekt).
  - Pro Kundenobjekt ein Eintrag in der `properties`-Tabelle:
    `property_id`, `label` (Anzeigename), `report_token` (crypto-random).
  - Daraus entsteht der private Link: `…/report/<property_id>?token=<report_token>`
  - *Technik:* Token-gated, constant-time Vergleich, einheitliche 404 bei Fehlversuch.
    Der Report selbst existiert schon: KPIs, Verweildauer, Tour-Funnel, beliebteste
    Punkte, Concierge-Fragen, Lead-Tabelle. Design "premium, calm, Apple-like".

- [ ] **1.2 Report-Link ans CRM heften** · `DU` (2 Min) oder `ICH` (per Konnektor)
  - Custom Field `report_url` am Makler-Kontakt in GHL, Wert = sein privater Link.

- [ ] **1.3 Zustell-Workflow "Monats-Report" in GHL** · `DU` baut, `ICH` liefert Text
  - Trigger: Tag `kunde:aktiv` wird gesetzt
  - → CI-Mail mit `{{contact.report_url}}` ("Ihr Bericht liegt bereit")
  - → **Wait 30 Tage** → **Go To** zurück zur Mail (GHLs Schleifen-Muster)
  - Kündigung: Tag entfernen + Kontakt aus Workflow nehmen → Schleife endet.
  - Settings: Re-Enrollment aus.

- [x] **1.4 Report-Mail-Text** · `ICH` · erledigt 14.07.: `report-email.html` (Repo-Root)
  - CI-HTML im dunklen Brief-Stil, nutzt {{contact.report_url}}. Bewusste Abweichung:
    KEINE konkrete Zahl in der Mail — GHL kennt die Report-Zahlen nicht, eine erfundene
    Zahl wäre gelogen. Die Mail teasert stattdessen, der Bericht liefert die Zahlen.

---

## Teil 2: Flaggschiff 2 — Hot-Lead-Alarm für Makler

**Wofür:** Der Makler erfährt in Minuten, wenn im Rundgang etwas Heißes passiert.
Der "Woher wussten Sie das?"-Moment, der süchtig macht.

**Ehrliche Korrektur:** "Dritter Besuch derselben Person" geht NICHT — der Viewer ist
bewusst anonym gebaut (keine Cookies, Sessions nicht verknüpfbar; Datenschutz als Feature).
Die heißen Signale kommen aus einer einzelnen Session, und die reichen:

| Signal | Stärke | Status |
|---|---|---|
| Anfrage im Viewer abgeschickt (`/lead`) | ★★★ | wird gespeichert, aber NIEMAND wird benachrichtigt |
| Concierge-Frage gestellt | ★★ | im Event-Strom vorhanden |
| Tour komplett durchlaufen | ★★ | im Event-Strom vorhanden |
| Sehr lange Verweildauer (heartbeat) | ★ | im Event-Strom vorhanden |

- [x] **2.1 MVP: Lead-Weiterleitung in Echtzeit** · `ICH` · Code fertig 14.07., Deploy offen
  - Migration `0003_property_owner.sql` (owner_email), `forwardHotLead` in analytics.ts,
    Env `GHL_HOTLEAD_WEBHOOK_URL` + ctx.waitUntil in worker.ts. 6 neue Tests, Suite 100/100 grün.
  - Live erst nach: Migration remote anwenden + `wrangler deploy` + Secret setzen (alles DU).
  - Migration: `properties`-Tabelle + Spalte `owner_email` (der Makler des Objekts).
  - Worker: Nach erfolgreichem Lead-Insert zusätzlich POST an neuen
    **GHL-Inbound-Webhook** (env `GHL_HOTLEAD_WEBHOOK_URL`) mit
    `{ ownerEmail, propertyLabel, leadName, leadContact, signal }`.
  - *Technik:* Fire-and-forget wie alles im Worker — ein GHL-Ausfall darf nie
    den Viewer oder das Lead-Speichern brechen.

- [ ] **2.2 GHL-Workflow "Hot-Lead-Alarm"** · `DU` baut — Klick-Anleitung, Test-Payload
  (curl) und CI-Mail liegen bereit: `ghl-anleitung-flaggschiffe.md` + `hotlead-alarm-email.html`
  - Trigger: Inbound Webhook (neu anlegen, Mapping per Test-Payload von ICH)
  - → Find/Create Contact über `ownerEmail` (der Makler)
  - → CI-Mail an Makler: "Zu Ihrem Objekt … ist soeben eine Anfrage eingegangen."
  - → Internal Notification an dich (Kopie des Alarms)

- [ ] **2.3 Ausbaustufe (nach MVP, wenn echte Daten da sind)** · später
  - Schwellwert-Signale (Verweildauer > X min, tour_complete) als
    "Interesse-Hinweis"-Mail. Erst kalibrieren, wenn echte Nutzung sichtbar ist.

---

## Reihenfolge & Abhängigkeiten

```
Teil 0: Fundament (0.1 → 0.5)
   └─→ Teil 1: Report (1.1 → 1.4)        [nur von Teil 0 abhängig]
   └─→ Teil 2: Alarm  (2.1 → 2.3)        [nur von Teil 0 abhängig]
```

**Nächster Schritt:** Antwort auf 0.1 (Cloudflare-Account). Danach bereite ich 0.2
vor und du führst 0.3 aus. Alles Weitere in gewohnter Arbeitsteilung.

## Offene Nebenpunkte (nicht Teil der Flaggschiffe, aber im Blick behalten)

- Website-Deploy: Branch `feat/speed-to-lead-webhook` liegt bereit, noch nicht gepusht
  (Speed-to-Lead wird erst mit Deploy wirksam).
- Workflow "Instant Reply w/o followup": Zweck ungeklärt — mögliche Kollision mit
  Antwort-Stopp (beide evtl. auf "Customer Replied").
- E-Mail-Empfang prüfen: Settings → Email Services (sonst feuert "Customer Replied" nie).
- GHL-Workflows: alle 4 standen zuletzt auf Draft — nach dem Befüllen publishen.
