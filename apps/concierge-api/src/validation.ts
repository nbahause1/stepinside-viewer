/**
 * Input validation + caps for the concierge endpoint.
 *
 * Critical security property: the request type has NO `system` and NO
 * `knowledge` field. A client physically cannot smuggle a system prompt or
 * knowledge into the call — the server is the sole source of both. We validate
 * only the small, fixed shape `{ propertyId, messages, room }`.
 */

/** A single chat turn as sent by the browser. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A camera jump target the model may choose to focus (no coordinates here). */
export interface FocusTarget {
  id: string;
  label: string;
  keywords?: string[];
}

/** The validated, trusted request payload. */
export interface ConciergeRequest {
  propertyId: string;
  messages: ChatMessage[];
  /** Scene/room name for context, or null. Never used to inject a prompt. */
  room: string | null;
  /** Curated focus targets the model may pick from (id + label + keywords). */
  pois: FocusTarget[];
}

/** Thrown for any malformed input; mapped to HTTP 400 by the core. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_MESSAGES = 12;
const MAX_CONTENT_CHARS = 1000;
const MAX_TOTAL_CHARS = 8000;
const MAX_ROOM_CHARS = 64;
const PROPERTY_ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_POIS = 40;
const MAX_POI_STR_CHARS = 64;
const MAX_POI_KEYWORDS = 16;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an arbitrary parsed JSON body into a typed ConciergeRequest.
 * Throws ValidationError (=> 400) on any cap violation or shape mismatch.
 */
export function validateRequest(body: unknown): ConciergeRequest {
  if (!isObject(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  const propertyId = body['propertyId'];
  if (typeof propertyId !== 'string' || !PROPERTY_ID_RE.test(propertyId)) {
    throw new ValidationError(
      'Field "propertyId" must match ^[a-z0-9-]{1,64}$.',
    );
  }

  const rawMessages = body['messages'];
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new ValidationError('Field "messages" must be a non-empty array.');
  }
  if (rawMessages.length > MAX_MESSAGES) {
    throw new ValidationError(`Too many messages (max ${MAX_MESSAGES}).`);
  }

  let totalChars = 0;
  const messages: ChatMessage[] = rawMessages.map((raw, i) => {
    if (!isObject(raw)) {
      throw new ValidationError(`messages[${i}] must be an object.`);
    }
    const role = raw['role'];
    if (role !== 'user' && role !== 'assistant') {
      throw new ValidationError(`messages[${i}].role must be "user" or "assistant".`);
    }
    const content = raw['content'];
    if (typeof content !== 'string' || content.length === 0) {
      throw new ValidationError(`messages[${i}].content must be a non-empty string.`);
    }
    if (content.length > MAX_CONTENT_CHARS) {
      throw new ValidationError(
        `messages[${i}].content exceeds ${MAX_CONTENT_CHARS} characters.`,
      );
    }
    totalChars += content.length;
    return { role, content };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw new ValidationError(`Total message content exceeds ${MAX_TOTAL_CHARS} characters.`);
  }

  if (messages[0].role !== 'user') {
    throw new ValidationError('The first message must have role "user".');
  }

  const rawRoom = body['room'];
  let room: string | null;
  if (rawRoom === null || rawRoom === undefined) {
    room = null;
  } else if (typeof rawRoom === 'string') {
    if (rawRoom.length > MAX_ROOM_CHARS) {
      throw new ValidationError(`Field "room" exceeds ${MAX_ROOM_CHARS} characters.`);
    }
    room = rawRoom;
  } else {
    throw new ValidationError('Field "room" must be a string or null.');
  }

  const pois = validatePois(body['pois']);

  return { propertyId, messages, room, pois };
}

/** Validate the optional focus-target list. Non-strings/over-cap → 400. */
function validatePois(raw: unknown): FocusTarget[] {
  if (raw === null || raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ValidationError('Field "pois" must be an array.');
  }
  if (raw.length > MAX_POIS) {
    throw new ValidationError(`Too many pois (max ${MAX_POIS}).`);
  }
  return raw.map((p, i) => {
    if (!isObject(p)) {
      throw new ValidationError(`pois[${i}] must be an object.`);
    }
    const id = p['id'];
    const label = p['label'];
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_POI_STR_CHARS) {
      throw new ValidationError(`pois[${i}].id must be a string up to ${MAX_POI_STR_CHARS} chars.`);
    }
    if (typeof label !== 'string' || label.length === 0 || label.length > MAX_POI_STR_CHARS) {
      throw new ValidationError(`pois[${i}].label must be a string up to ${MAX_POI_STR_CHARS} chars.`);
    }
    const rawKeywords = p['keywords'];
    let keywords: string[] | undefined;
    if (rawKeywords !== undefined) {
      if (!Array.isArray(rawKeywords) || rawKeywords.length > MAX_POI_KEYWORDS) {
        throw new ValidationError(`pois[${i}].keywords must be an array of up to ${MAX_POI_KEYWORDS} strings.`);
      }
      keywords = rawKeywords.map((k, j) => {
        if (typeof k !== 'string' || k.length > MAX_POI_STR_CHARS) {
          throw new ValidationError(`pois[${i}].keywords[${j}] must be a string up to ${MAX_POI_STR_CHARS} chars.`);
        }
        return k;
      });
    }
    return keywords ? { id, label, keywords } : { id, label };
  });
}
