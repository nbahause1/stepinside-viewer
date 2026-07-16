/**
 * Knowledge base types + validation + deterministic serialization.
 *
 * The schema is intentionally "room-ready": every fact carries a `rooms` array
 * and the KB carries a top-level `rooms` list. For this MVP `rooms` is plumbed
 * but never used to filter; Phase 2 (camera-vs-bbox zone detection) becomes a
 * purely additive change with no schema migration.
 */

/**
 * Who the assistant is talking to. Drives the persona line of the system
 * prompt: 'fewo' = vacation-rental guest, 'kauf' = prospective buyer viewing a
 * sales listing, 'miete' = prospective tenant. Defaults to 'fewo' so existing
 * KB files stay valid.
 */
export type PropertyContext = 'fewo' | 'kauf' | 'miete';

const PROPERTY_CONTEXTS: readonly PropertyContext[] = ['fewo', 'kauf', 'miete'];

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

/**
 * A nearby place the concierge may point the viewer's neighbourhood map at.
 * Mirror of the viewer's settings.surroundings.pois, WITHOUT coordinates or
 * route geometry — the model only needs names and walking minutes for its
 * answer text; the map data lives client-side. Generated once per property by
 * apps/viewer/scripts/fetch-surroundings.mjs --kb.
 */
export interface SurroundingsPoi {
  /** Stable id, must match the viewer's settings.surroundings.pois[].id. */
  id: string;
  /** Category label ("Supermarkt"). */
  label: string;
  /** Real place name ("EDEKA Schlemmermarkt Struve"). */
  name: string;
  walkMinutes: number;
}

/** A per-property knowledge base. */
export interface KnowledgeBase {
  propertyId: string;
  displayName: string;
  /** Audience the assistant addresses (see PropertyContext). */
  context: PropertyContext;
  rooms: Room[];
  facts: Fact[];
  /** Localized "I don't know" message used when a question is out of scope. */
  fallback: LocalizedText;
  /**
   * Optional brand voice: a short style instruction for the assistant's tone
   * (per broker/customer, e.g. "hanseatisch zurückhaltend, keine Superlative").
   * Keep it to a few sentences — it lives in the cached prompt prefix, so it
   * costs almost nothing per message, but it is not the place for a brand book.
   */
  voice?: string;
  /** Optional nearby places for the "what's around here" questions + map. */
  surroundings?: SurroundingsPoi[];
  /**
   * Optional property coordinates (WGS84). Enables the find_place tool: the
   * concierge can look up places the visitor asks about ("nächster
   * MediaMarkt?") that are not in `surroundings`, with real walking/driving
   * minutes from this point. Without it the tool is not offered at all.
   */
  location?: { lng: number; lat: number };
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

  const rawContext = raw['context'];
  let context: PropertyContext = 'fewo';
  if (rawContext !== undefined) {
    if (
      typeof rawContext !== 'string' ||
      !PROPERTY_CONTEXTS.includes(rawContext as PropertyContext)
    ) {
      throw new KnowledgeValidationError(
        `knowledge base: "context" must be one of ${PROPERTY_CONTEXTS.join(', ')}`,
      );
    }
    context = rawContext as PropertyContext;
  }

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

  const rawVoice = raw['voice'];
  let voice: string | undefined;
  if (rawVoice !== undefined) {
    if (typeof rawVoice !== 'string' || rawVoice.length === 0 || rawVoice.length > 1500) {
      throw new KnowledgeValidationError(
        'knowledge base: "voice" must be a non-empty string of at most 1500 characters',
      );
    }
    voice = rawVoice;
  }

  const rawSurroundings = raw['surroundings'];
  let surroundings: SurroundingsPoi[] | undefined;
  if (rawSurroundings !== undefined) {
    if (!Array.isArray(rawSurroundings) || rawSurroundings.length === 0) {
      throw new KnowledgeValidationError(
        'knowledge base: "surroundings" must be a non-empty array when present',
      );
    }
    const seen = new Set<string>();
    surroundings = rawSurroundings.map((poiValue, i) => {
      if (!isObject(poiValue)) {
        throw new KnowledgeValidationError(`surroundings[${i}]: must be an object`);
      }
      const id = requireString(poiValue, 'id', `surroundings[${i}]`);
      if (seen.has(id)) {
        throw new KnowledgeValidationError(`surroundings[${i}]: duplicate id "${id}"`);
      }
      seen.add(id);
      const walkMinutes = poiValue['walkMinutes'];
      if (typeof walkMinutes !== 'number' || !Number.isFinite(walkMinutes) || walkMinutes <= 0) {
        throw new KnowledgeValidationError(
          `surroundings[${i}].walkMinutes: must be a positive number`,
        );
      }
      return {
        id,
        label: requireString(poiValue, 'label', `surroundings[${i}]`),
        name: requireString(poiValue, 'name', `surroundings[${i}]`),
        walkMinutes,
      };
    });
  }

  const rawLocation = raw['location'];
  let location: { lng: number; lat: number } | undefined;
  if (rawLocation !== undefined) {
    if (!isObject(rawLocation)) {
      throw new KnowledgeValidationError('knowledge base: "location" must be an object');
    }
    const lng = rawLocation['lng'];
    const lat = rawLocation['lat'];
    if (
      typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
      typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90
    ) {
      throw new KnowledgeValidationError(
        'knowledge base: "location" must carry finite lng (-180..180) and lat (-90..90)',
      );
    }
    location = { lng, lat };
  }

  const kb: KnowledgeBase = { propertyId, displayName, context, rooms, facts, fallback };
  if (voice !== undefined) kb.voice = voice;
  if (surroundings !== undefined) kb.surroundings = surroundings;
  if (location !== undefined) kb.location = location;
  return kb;
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
