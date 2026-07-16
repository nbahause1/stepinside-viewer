/**
 * Hot-lead alarm (Flaggschiff 2): handleLead forwards every STORED lead to the
 * GHL inbound webhook — and only then. The forward is fire-and-forget: a
 * broken webhook, a missing properties row, or a failing owner_email lookup
 * must never change the /lead response or lose the lead.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleLead } from '../src/analytics.js';
import type { D1Like, D1StatementLike, HotLeadForward } from '../src/analytics.js';

const VALID_LEAD = {
  propertyId: 'demo-altbau',
  name: 'Max Mustermann',
  contact: 'max@example.com',
  message: 'Gerne Besichtigung am Wochenende.',
  consent: true,
};

/** Fake D1: leads INSERT succeeds; properties SELECT returns `propertyRow`. */
function fakeDb(propertyRow: Record<string, unknown> | null | 'throw'): D1Like {
  const statement = (query: string): D1StatementLike => ({
    bind: () => statement(query),
    run: async () => ({}),
    all: async () => ({ results: [] }),
    first: async () => {
      if (propertyRow === 'throw') throw new Error('no such column: owner_email');
      return propertyRow;
    },
  });
  return { prepare: statement, batch: async () => [] };
}

function capturingForward(overrides?: Partial<HotLeadForward>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const tasks: Promise<unknown>[] = [];
  const forward: HotLeadForward = {
    webhookUrl: 'https://ghl.example.com/hook/abc',
    waitUntil: (task) => tasks.push(task),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
    ...overrides,
  };
  return { forward, calls, tasks, settle: () => Promise.all(tasks) };
}

describe('handleLead hot-lead forward', () => {
  it('POSTs the stored lead with owner data to the webhook', async () => {
    const { forward, calls, settle } = capturingForward();
    const db = fakeDb({ label: 'Altbau Eppendorf', owner_email: 'makler@example.com' });

    const result = await handleLead(VALID_LEAD, db, undefined, forward);
    await settle();

    expect(result.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ghl.example.com/hook/abc');
    expect(calls[0].body).toMatchObject({
      signal: 'lead',
      propertyId: 'demo-altbau',
      propertyLabel: 'Altbau Eppendorf',
      ownerEmail: 'makler@example.com',
      leadName: 'Max Mustermann',
      leadContact: 'max@example.com',
    });
  });

  it('still fires (with null owner fields) when the property is unregistered', async () => {
    const { forward, calls, settle } = capturingForward();

    const result = await handleLead(VALID_LEAD, fakeDb(null), undefined, forward);
    await settle();

    expect(result.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ propertyLabel: null, ownerEmail: null });
  });

  it('still fires when the owner lookup throws (migration 0003 not applied)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { forward, calls, settle } = capturingForward();

    const result = await handleLead(VALID_LEAD, fakeDb('throw'), undefined, forward);
    await settle();

    expect(result.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ propertyLabel: null, ownerEmail: null });
    warn.mockRestore();
  });

  it('keeps the 202 when the webhook itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { forward, tasks } = capturingForward({
      fetchImpl: async () => {
        throw new Error('connect timeout');
      },
    });

    const result = await handleLead(VALID_LEAD, fakeDb(null), undefined, forward);
    await Promise.all(tasks);

    expect(result.status).toBe(202);
    expect(warn).toHaveBeenCalledWith('[analytics] hot-lead webhook failed:', expect.stringContaining('connect timeout'));
    warn.mockRestore();
  });

  it('does NOT fire on a validation error (nothing stored, nothing forwarded)', async () => {
    const { forward, calls, settle } = capturingForward();

    const result = await handleLead({ propertyId: 'demo-altbau' }, fakeDb(null), undefined, forward);
    await settle();

    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('does NOT fire when the lead insert fails (no stored lead, no alarm)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { forward, calls, settle } = capturingForward();
    const statement = (): D1StatementLike => ({
      bind: () => statement(),
      run: async () => {
        throw new Error('D1 write failed');
      },
      all: async () => ({ results: [] }),
      first: async () => null,
    });
    const db: D1Like = { prepare: statement, batch: async () => [] };

    const result = await handleLead(VALID_LEAD, db, undefined, forward);
    await settle();

    expect(result.status).toBe(500);
    expect(calls).toHaveLength(0);
    warn.mockRestore();
  });
});
