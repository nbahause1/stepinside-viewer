/**
 * Knowledge base types + validation + deterministic serialization.
 *
 * The schema is intentionally "room-ready": every fact carries a `rooms` array
 * and the KB carries a top-level `rooms` list. For this MVP `rooms` is plumbed
 * but never used to filter; Phase 2 (camera-vs-bbox zone detection) becomes a
 * purely additive change with no schema migration.
 */

/** Localized label, keyed by language code (e.g. "de", "en"). */
export interface LocalizedText {
  de: string;
  en: string;
  [lang: string]: string;
}

/** A named zone of the property. Used by Phase 2 to scope facts. */
export interface Room {
  id: string;
  label: LocalizedText;
}

/** A single owner-provided fact the concierge may answer from. */
export interface Fact {
  id: string;
  topic: string;
  /** Room ids this fact applies to; empty = whole property. */
  rooms: string[];
  text: string;
}

/** A per-property knowledge base. */
export interface KnowledgeBase {
  propertyId: string;
  displayName: string;
  rooms: Room[];
  facts: Fact[];
  /** Localized "I don't know" message used when a question is out of scope. */
  fallback: LocalizedText;
}

/** A function that resolves a propertyId to its KB, or null if unknown. */
export type KnowledgeLoader = (
  propertyId: string,
) => Promise<KnowledgeBase | null> | KnowledgeBase | null;

/** Thrown when a KB file fails schema validation. */
export class KnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeValidationError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new KnowledgeValidationError(
      `${context}: field "${key}" must be a non-empty string`,
    );
  }
  return value;
}

function validateLocalizedText(value: unknown, context: string): LocalizedText {
  if (!isObject(value)) {
    throw new KnowledgeValidationError(`${context}: must be an object of language codes`);
  }
  const de = value['de'];
  const en = value['en'];
  if (typeof de !== 'string' || de.length === 0) {
    throw new KnowledgeValidationError(`${context}: "de" must be a non-empty string`);
  }
  if (typeof en !== 'string' || en.length === 0) {
    throw new KnowledgeValidationError(`${context}: "en" must be a non-empty string`);
  }
  const out: LocalizedText = { de, en };
  for (const [lang, text] of Object.entries(value)) {
    if (typeof text !== 'string' || text.length === 0) {
      throw new KnowledgeValidationError(`${context}: "${lang}" must be a non-empty string`);
    }
    out[lang] = text;
  }
  return out;
}

/**
 * Validate an unknown (parsed JSON) value into a typed KnowledgeBase.
 * Throws KnowledgeValidationError on any structural problem.
 */
export function validateKnowledge(raw: unknown): KnowledgeBase {
  if (!isObject(raw)) {
    throw new KnowledgeValidationError('knowledge base: root must be an object');
  }

  const propertyId = requireString(raw, 'propertyId', 'knowledge base');
  const displayName = requireString(raw, 'displayName', 'knowledge base');

  const rawRooms = raw['rooms'];
  if (!Array.isArray(rawRooms)) {
    throw new KnowledgeValidationError('knowledge base: "rooms" must be an array');
  }
  const rooms: Room[] = rawRooms.map((roomValue, i) => {
    if (!isObject(roomValue)) {
      throw new KnowledgeValidationError(`rooms[${i}]: must be an object`);
    }
    return {
      id: requireString(roomValue, 'id', `rooms[${i}]`),
      label: validateLocalizedText(roomValue['label'], `rooms[${i}].label`),
    };
  });
  const roomIds = new Set(rooms.map((r) => r.id));

  const rawFacts = raw['facts'];
  if (!Array.isArray(rawFacts) || rawFacts.length === 0) {
    throw new KnowledgeValidationError('knowledge base: "facts" must be a non-empty array');
  }
  const facts: Fact[] = rawFacts.map((factValue, i) => {
    if (!isObject(factValue)) {
      throw new KnowledgeValidationError(`facts[${i}]: must be an object`);
    }
    const factRoomsRaw = factValue['rooms'];
    if (!Array.isArray(factRoomsRaw)) {
      throw new KnowledgeValidationError(`facts[${i}].rooms: must be an array`);
    }
    const factRooms = factRoomsRaw.map((r, j) => {
      if (typeof r !== 'string' || r.length === 0) {
        throw new KnowledgeValidationError(`facts[${i}].rooms[${j}]: must be a non-empty string`);
      }
      if (!roomIds.has(r)) {
        throw new KnowledgeValidationError(
          `facts[${i}].rooms[${j}]: unknown room id "${r}"`,
        );
      }
      return r;
    });
    return {
      id: requireString(factValue, 'id', `facts[${i}]`),
      topic: requireString(factValue, 'topic', `facts[${i}]`),
      rooms: factRooms,
      text: requireString(factValue, 'text', `facts[${i}]`),
    };
  });

  const fallback = validateLocalizedText(raw['fallback'], 'knowledge base.fallback');

  return { propertyId, displayName, rooms, facts, fallback };
}

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 *
 * Prompt caching keys on a *byte-stable* system prefix. JSON.stringify preserves
 * insertion order, which can drift between a hand-edited file and an in-memory
 * object; sorting keys guarantees the cached KB block is identical every call.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}
