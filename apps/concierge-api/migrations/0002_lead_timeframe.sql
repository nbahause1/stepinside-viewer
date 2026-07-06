-- Lead qualification: the move-in timeframe captured on the appointment
-- ("Besichtigung") path — the "Ab wann könnten Sie sich einen Einzug
-- vorstellen?" question, so the owner can propose suitable viewing slots and
-- prioritise hotter leads.
--
-- Apply (remote / production):
--   npx wrangler d1 migrations apply stepinside-analytics --remote
-- Local (wrangler dev):
--   npx wrangler d1 migrations apply stepinside-analytics --local

ALTER TABLE leads ADD COLUMN timeframe TEXT;
