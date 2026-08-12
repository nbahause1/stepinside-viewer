# NEEDS-CONFIG — akquise / v1

Geometry is derived automatically. The items below need a human before go-live.

## BLOCKING (leads / concierge / map are wrong or dead without these)
- [ ] **settings.json concierge.contact + greeting**
      Demo broker contact inherited from the base template; neutralized to empty.
      → Edit C:\Users\Hauke\projekte\si-sit\dist\onboard\akquise\v1\settings.json → concierge.contact (name/phone/email/exposeUrl) + concierge.greeting
- [ ] **settings.json surroundings**
      Demo location removed (map would centre on it). No map pill until set.
      → node apps/viewer/scripts/fetch-surroundings.mjs --lat <lat> --lng <lng>  → paste into C:\Users\Hauke\projekte\si-sit\dist\onboard\akquise\v1\settings.json surroundings
- [ ] **D1 properties.lead_webhook_url**
      Without a property row + webhook, hot leads forward to the global inbox with no broker attribution (or nowhere).
      → cd apps/concierge-api && node scripts/register-property.mjs akquise "<Label>" <owner-email> <https-webhook-url>
- [ ] **apps/concierge-api/knowledge/akquise.json**
      Concierge has no property facts until a knowledge base is authored, imported in worker.ts and redeployed.
      → Author apps/concierge-api/knowledge/akquise.json, register it in worker.ts, redeploy

## OPTIONAL
- [ ] **settings.json inquiry.email**
      Demo mailto inbox removed. The in-viewer lead form still routes by propertyId; email is only the mailto fallback.
      → Edit C:\Users\Hauke\projekte\si-sit\dist\onboard\akquise\v1\settings.json → inquiry.email (real mailto fallback recipient)
- [ ] **settings.json rooms (named entries)**
      Room DIMENSIONS are authored manually per property (like highlights) — auto-derivation is unreliable on open/L-shaped flats. The dollhouse cutaway already spans the whole flat from a nameless footprint entry; no measurement labels show until you author rooms.
      → In the viewer, stand in a room and run roomEntry() (measure tool) to append a NAMED rooms[] entry; repeat per room. Empty is a valid launch state.
- [ ] **settings.json annotations**
      Highlights are authored manually; empty is a valid launch state.
      → Author in the viewer annotation tool when ready (each links a camera move).

Derived automatically (no action): start camera, 3 aerial views, room L×W×H + floor-plan, dollhouse clip, collision.
