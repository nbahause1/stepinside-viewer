#!/usr/bin/env node
/**
 * Register (or update) a property for the owner report + hot-lead alarm.
 *
 * Creates the row in the D1 `properties` table with a fresh crypto-random
 * report token and prints the private report URL to hand to the broker.
 * Re-running for an existing property_id keeps the row but REPLACES the
 * token (old report links stop working — that is the "revoke" story).
 *
 * Usage (from apps/concierge-api):
 *   node scripts/register-property.mjs <property-id> "<Label>" [owner-email] [lead-webhook-url]
 * Example:
 *   node scripts/register-property.mjs demo-altbau "Altbau-Etage Eppendorf" makler@example.com
 *   node scripts/register-property.mjs demo-altbau "Altbau-Etage Eppendorf" makler@example.com https://hooks.zapier.com/hooks/catch/123/abc
 *
 * The lead-webhook-url is the broker's OWN inbound hook (CRM / Zapier / Make /
 * n8n / GHL). When set, leads for this property forward there instead of the
 * global GHL_HOTLEAD_WEBHOOK_URL. Omit it to keep the global default.
 *
 * Add --local to target the local wrangler dev database instead of production.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const WORKER_BASE = 'https://concierge-api.stepinside-eu.workers.dev';
const DB_NAME = 'innsyn-analytics';

const args = process.argv.slice(2).filter((a) => a !== '--local');
const local = process.argv.includes('--local');
const [propertyId, label, ownerEmail, leadWebhookUrl] = args;

if (!propertyId || !label) {
  console.error('Usage: node scripts/register-property.mjs <property-id> "<Label>" [owner-email] [lead-webhook-url] [--local]');
  process.exit(1);
}
if (!/^[a-z0-9-]{1,64}$/.test(propertyId)) {
  console.error('property-id must match ^[a-z0-9-]{1,64}$ (lowercase, digits, hyphens).');
  process.exit(1);
}
if (leadWebhookUrl && !/^https:\/\//.test(leadWebhookUrl)) {
  console.error('lead-webhook-url must be an https:// URL.');
  process.exit(1);
}

// 32 random bytes -> 64 hex chars. Compared constant-time server-side (auth.ts).
const token = randomBytes(32).toString('hex');

// Values are passed through SQL string literals; single quotes doubled per
// SQLite rules. propertyId is already shape-checked above.
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sql =
  `INSERT INTO properties (property_id, report_token, label, owner_email, lead_webhook_url) ` +
  `VALUES (${q(propertyId)}, ${q(token)}, ${q(label)}, ${q(ownerEmail ?? null)}, ${q(leadWebhookUrl ?? null)}) ` +
  `ON CONFLICT(property_id) DO UPDATE SET report_token=excluded.report_token, ` +
  `label=excluded.label, owner_email=excluded.owner_email, lead_webhook_url=excluded.lead_webhook_url;`;

execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', DB_NAME, local ? '--local' : '--remote', '--command', sql],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

console.log('');
console.log(`Registriert: ${propertyId} ("${label}")${ownerEmail ? ` · Makler: ${ownerEmail}` : ''}${leadWebhookUrl ? ` · Lead-Webhook: ${leadWebhookUrl}` : ''}`);
console.log('Privater Report-Link (an den Makler geben, gilt bis zur nächsten Registrierung):');
console.log(`  ${WORKER_BASE}/report/${propertyId}?token=${token}`);
