-- Hot-lead alarm (Flaggschiff 2): the broker who owns a property. When a lead
-- arrives for the property, the worker forwards it to the GHL inbound webhook
-- (env GHL_HOTLEAD_WEBHOOK_URL) and GHL notifies this address.
--
-- Apply (remote / production):
--   npx wrangler d1 migrations apply innsyn-analytics --remote
-- Local (wrangler dev):
--   npx wrangler d1 migrations apply innsyn-analytics --local

ALTER TABLE properties ADD COLUMN owner_email TEXT;
