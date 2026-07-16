/**
 * Surroundings (neighbourhood map) — KB validation and prompt wiring.
 *
 * The mapPoi RESPONSE filtering (only ids from kb.surroundings survive) lives
 * in core.ts's private parseStructured; it is exercised indirectly here via
 * the same id-set rule applied at the validation layer, and end-to-end by the
 * viewer. These tests pin down the contract that matters server-side: what a
 * KB may declare, and that the prompt only teaches mapPoi when data exists.
 */
import { describe, it, expect } from 'vitest';
import { validateKnowledge, KnowledgeValidationError } from '../src/knowledge.js';
import { buildSystemBlocks } from '../src/prompt.js';

const baseKb = {
  propertyId: 'test-prop',
  displayName: 'Testwohnung',
  context: 'kauf',
  rooms: [],
  facts: [{ id: 'f1', topic: 'misc', rooms: [], text: 'Ein Fakt.' }],
  fallback: { de: 'Weiß ich nicht.', en: "Don't know." },
};

const poi = { id: 'supermarkt', label: 'Supermarkt', name: 'EDEKA', walkMinutes: 7 };

describe('validateKnowledge: surroundings', () => {
  it('accepts a KB without surroundings (backwards compatible)', () => {
    const kb = validateKnowledge(baseKb);
    expect(kb.surroundings).toBeUndefined();
  });

  it('accepts a valid surroundings list', () => {
    const kb = validateKnowledge({ ...baseKb, surroundings: [poi] });
    expect(kb.surroundings).toEqual([poi]);
  });

  it('rejects an empty surroundings array', () => {
    expect(() => validateKnowledge({ ...baseKb, surroundings: [] }))
      .toThrow(KnowledgeValidationError);
  });

  it('rejects duplicate poi ids', () => {
    expect(() => validateKnowledge({ ...baseKb, surroundings: [poi, { ...poi, name: 'REWE' }] }))
      .toThrow(/duplicate id/);
  });

  it.each([
    ['missing id', { label: 'Supermarkt', name: 'EDEKA', walkMinutes: 7 }],
    ['empty label', { ...poi, label: '' }],
    ['missing name', { id: 'x', label: 'Supermarkt', walkMinutes: 7 }],
    ['zero walkMinutes', { ...poi, walkMinutes: 0 }],
    ['negative walkMinutes', { ...poi, walkMinutes: -3 }],
    ['non-numeric walkMinutes', { ...poi, walkMinutes: '7' }],
    ['non-object entry', 'supermarkt'],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateKnowledge({ ...baseKb, surroundings: [bad] }))
      .toThrow(KnowledgeValidationError);
  });

  it('strips unknown extra keys implicitly (only declared fields survive)', () => {
    const kb = validateKnowledge({
      ...baseKb,
      surroundings: [{ ...poi, route: [[1, 2]], lngLat: [9.98, 53.59] }],
    });
    // Route geometry stays client-side by design: the model gets names and
    // minutes, never coordinates.
    expect(kb.surroundings![0]).toEqual(poi);
  });
});

describe('validateKnowledge: location', () => {
  it('accepts a KB without location (tool simply not offered)', () => {
    expect(validateKnowledge(baseKb).location).toBeUndefined();
  });

  it('accepts valid coordinates', () => {
    const kb = validateKnowledge({ ...baseKb, location: { lng: 9.9838, lat: 53.5895 } });
    expect(kb.location).toEqual({ lng: 9.9838, lat: 53.5895 });
  });

  it.each([
    ['out-of-range lng', { lng: 191, lat: 53 }],
    ['out-of-range lat', { lng: 9.98, lat: 91 }],
    ['non-numeric', { lng: '9.98', lat: 53.59 }],
    ['missing lat', { lng: 9.98 }],
    ['non-object', [9.98, 53.59]],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateKnowledge({ ...baseKb, location: bad }))
      .toThrow(KnowledgeValidationError);
  });
});

describe('buildSystemBlocks: place-search section', () => {
  it('teaches find_place only when the KB has coordinates', () => {
    const withLocation = validateKnowledge({ ...baseKb, location: { lng: 9.98, lat: 53.59 } });
    const [rules] = buildSystemBlocks(withLocation, []);
    expect(rules.text).toContain('PLACE SEARCH');
    expect(rules.text).toContain('find_place');

    const withoutLocation = validateKnowledge(baseKb);
    const [rulesWithout] = buildSystemBlocks(withoutLocation, []);
    expect(rulesWithout.text).not.toContain('PLACE SEARCH');
  });
});

describe('buildSystemBlocks: neighbourhood-map section', () => {
  it('teaches mapPoi when the KB has surroundings', () => {
    const kb = validateKnowledge({ ...baseKb, surroundings: [poi] });
    const [rules, knowledge] = buildSystemBlocks(kb, []);
    expect(rules.text).toContain('NEIGHBOURHOOD MAP');
    expect(rules.text).toContain('"mapPoi"');
    // The names/minutes travel via the KNOWLEDGE block (whole-KB serialization).
    expect(knowledge.text).toContain('EDEKA');
    expect(knowledge.text).toContain('walkMinutes');
  });

  it('omits the section entirely without surroundings (cache-stable prompts)', () => {
    const kb = validateKnowledge(baseKb);
    const [rules] = buildSystemBlocks(kb, []);
    expect(rules.text).not.toContain('NEIGHBOURHOOD MAP');
    expect(rules.text).not.toContain('mapPoi');
  });
});
