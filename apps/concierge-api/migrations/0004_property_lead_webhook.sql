-- Phase 1 CRM hand-off: a per-property inbound-webhook URL. When a lead arrives
-- for the property, the worker forwards it here (the broker's own CRM / Zapier /
-- Make / n8n / GHL inbound hook) instead of the single global GHL webhook.
-- NULL keeps the global GHL_HOTLEAD_WEBHOOK_URL fallback, so existing properties
-- are unchanged.
--
-- Apply (remote / production):
--   npx wrangler d1 migrations apply innsyn-analytics --remote
-- Local (wrangler dev):
--   npx wrangler d1 migrations apply innsyn-analytics --local

ALTER TABLE properties ADD COLUMN lead_webhook_url TEXT;
