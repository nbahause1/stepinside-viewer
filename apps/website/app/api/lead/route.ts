/*
  Server-side proxy for contact-form leads.

  The public contact form (components/sections/Contact.tsx) posts here in
  addition to Formspree. This handler forwards the lead to the GoHighLevel
  "Speed-to-Lead" inbound webhook. It runs server-side on purpose: a browser
  cannot POST JSON to the LeadConnector webhook host directly (CORS), but our
  own server can. Formspree stays the email backup; this is the CRM path.

  The webhook URL is not a secret (it only accepts data), so it ships with a
  fallback. Override it per environment with GHL_LEAD_WEBHOOK_URL if the trigger
  is ever regenerated.
*/

const GHL_LEAD_WEBHOOK_URL =
  process.env.GHL_LEAD_WEBHOOK_URL ??
  "https://services.leadconnectorhq.com/hooks/YeJCMXcXl2tCovIxCfTX/webhook-trigger/20e1b5a5-d2fb-4ed3-ac8d-e88328691e11";

export async function POST(request: Request) {
  try {
    const { name, email, message } = await request.json();

    // GHL needs an email (or phone) to create/find the contact; without it the
    // workflow has no one to attach to, so reject early.
    if (!email || typeof email !== "string") {
      return Response.json({ ok: false, error: "email required" }, { status: 400 });
    }

    const res = await fetch(GHL_LEAD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: typeof name === "string" ? name : "",
        email,
        message: typeof message === "string" ? message : "",
        source: "myinnsyn.de Kontaktformular",
      }),
    });

    return Response.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
