/**
 * Framework-agnostic concierge brain.
 *
 * handleConcierge does NO Node/Workers I/O in its signature: all environment
 * access (api key, KB loading, rate limiter, client ip) is injected via `deps`,
 * so the same function runs verbatim on Cloudflare Workers, Vercel, and the
 * local Node dev server.
 *
 * Order of operations:
 *   1. Rate-limit (per clientIp) -> 429 before any work. (The Workers entry
 *      runs the real check BEFORE parsing the body and injects a pass-through
 *      limiter here, so the request is only counted once.)
 *   2. Validate input caps -> 400.
 *   3. Load knowledge for propertyId -> 400 if unknown; then consume the
 *      optional daily budget -> 429 once the cap is hit.
 *   4. Build system blocks (rules + cached KB).
 *   5. Call claude-haiku-4-5 (non-streaming, max_tokens 400).
 *   6. Return { status, body }. Errors mapped: RateLimitError->429, APIError->502.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { KnowledgeLoader } from './knowledge.js';
import type { RateLimiter, RateLimitResult } from './ratelimit.js';
import { validateRequest, ValidationError } from './validation.js';
import type { ConciergeRequest } from './validation.js';
import { buildSystemBlocks, buildRoomContextLine } from './prompt.js';
import { findPlace, PLACE_CATEGORIES } from './places.js';
import type { FoundPlace } from './places.js';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 400;

/**
 * Live place lookup for "wo ist der nächste X?" questions beyond the curated
 * surroundings list. Only offered when the KB carries the property's
 * coordinates; executed server-side by places.ts (Photon + OSRM). The
 * description is deliberately prescriptive about WHEN to call — that is what
 * drives the model's should-call decision.
 */
const FIND_PLACE_TOOL: Anthropic.Tool = {
  name: 'find_place',
  description:
    'Look up the nearest real place around the property with its name, address, and ' +
    'real walking/driving minutes. Call this when the visitor asks about a specific ' +
    'place or amenity that is not in KNOWLEDGE. For a KIND of place ("Fitnessstudio", ' +
    '"Zahnarzt") set `category` to the matching value; for a NAME or brand ' +
    '("MediaMarkt", "Alsterhaus") leave `category` unset and rely on `query`. ' +
    'At most one call per question.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Name or brand of the place to find, in the visitor\'s wording.',
      },
      category: {
        type: 'string',
        enum: Object.keys(PLACE_CATEGORIES),
        description: 'Kind of place, when the visitor asks for a category rather than a name.',
      },
    },
    required: ['query'],
  },
};

/** Dependencies injected by each entry point. */
export interface ConciergeDeps {
  apiKey: string;
  loadKnowledge: KnowledgeLoader;
  rateLimiter: RateLimiter;
  /** Best-effort client IP for rate limiting; '' if unknown. */
  clientIp: string;
  /**
   * Optional global daily spend cap (see KvDailyBudget in ratelimit.ts). It is
   * consumed AFTER the per-IP rate limit and input validation pass, immediately
   * before the paid Anthropic call — so rejected/garbage requests never burn
   * budget. When omitted (dev server, Vercel, no KV), no cap is enforced.
   */
  dailyBudget?: { consume(): Promise<RateLimitResult> };
}

/** A normalized result the entry points translate into their native response. */
export interface ConciergeResult {
  status: number;
  body: Record<string, unknown>;
  /** Seconds for a Retry-After header (set on 429). */
  retryAfterSeconds?: number;
}

/** Reuse one client per api key across invocations (warm isolate / process). */
const clientCache = new Map<string, Anthropic>();

function getClient(apiKey: string): Anthropic {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    clientCache.set(apiKey, client);
  }
  return client;
}

/**
 * Dimension-intent detector for the bird's-eye backstop. The model is reliable
 * about setting `showDimensions` when it can actually answer a size question,
 * but on a *fallback* answer it occasionally sets it false anyway (~1 in 4 for
 * borderline questions like "wie groß ist der Balkon?"). Since a size question
 * should still fly to the measurement overlay, we detect the intent from the
 * visitor's own words and force the flag in the fallback case (see below).
 * Kept deliberately broad on size vocabulary, so false negatives are rare; the
 * cost of a false positive is only a bird's-eye glide, never a wrong answer.
 */
const DIMENSION_INTENT_RE =
  /wie\s+(groß|breit|lang|hoch|tief|weit)|größe|abmessung|\bmaße\b|quadratmeter|\bqm\b|m²|fläche|deckenhöhe|raumhöhe|wandhöhe|passt\s+(mein|ein|der|die|das|meine)|how\s+(big|large|tall|wide|long|high|deep)|dimension|square\s+met(er|re)|\barea\b|ceiling\s+height/i;

/** The last user turn's text, for the dimension-intent backstop. */
function lastUserText(messages: ConciergeRequest['messages']): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      return messages[i].content;
    }
  }
  return '';
}

/**
 * Parse a possibly-untrusted JSON body and run the full concierge pipeline.
 * `rawBody` is the already-parsed JSON value from the entry point.
 */
export async function handleConcierge(
  rawBody: unknown,
  deps: ConciergeDeps,
): Promise<ConciergeResult> {
  // 1. Rate-limit first, keyed on the client IP (fallback to a shared bucket).
  const rateKey = deps.clientIp || 'unknown';
  const rate = await deps.rateLimiter.check(rateKey);
  if (!rate.allowed) {
    // `reason` lets the client tailor its message: 'burst' -> "please wait",
    // 'daily' -> terminal for today, show the broker contact card instead.
    const reason = rate.scope ?? 'burst';
    return {
      status: 429,
      body: {
        error: reason === 'daily'
          ? 'Daily question limit reached for this property.'
          : 'Too many requests. Please slow down.',
        reason,
      },
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  // 2. Validate input caps.
  let request;
  try {
    request = validateRequest(rawBody);
  } catch (err) {
    if (err instanceof ValidationError) {
      return { status: 400, body: { error: err.message } };
    }
    return { status: 400, body: { error: 'Invalid request.' } };
  }

  // 3. Load knowledge for this property.
  const kb = await deps.loadKnowledge(request.propertyId);
  if (!kb) {
    return { status: 400, body: { error: 'Unknown property.' } };
  }

  // 3b. Global daily spend cap (kill-switch). Checked after rate limit +
  //     validation so only requests that would actually reach the paid
  //     Anthropic call consume budget. 429 keeps the client's existing handling.
  if (deps.dailyBudget) {
    const budget = await deps.dailyBudget.consume();
    if (!budget.allowed) {
      return {
        status: 429,
        body: { error: 'The daily concierge budget is exhausted. Please try again tomorrow.' },
        retryAfterSeconds: budget.retryAfterSeconds,
      };
    }
  }

  // 4. Build system blocks (rules + focus targets + cached KB). Room context is
  //    injected into the latest user message below, NOT into the cached prefix.
  const system = buildSystemBlocks(kb, request.pois);

  const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const roomLine = buildRoomContextLine(request.room);
  if (roomLine.length > 0) {
    // Find the last user message and prepend the (volatile) room context.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const existing = messages[i].content;
        const text = typeof existing === 'string' ? existing : '';
        messages[i] = { role: 'user', content: `${roomLine}${text}` };
        break;
      }
    }
  }

  // 5. Call Claude. No temperature / thinking / effort / budget_tokens — Haiku
  //    rejects them. Non-streaming, max_tokens 400. Structured output forces a
  //    { answer, focus } JSON so we get the camera focus in the same call.
  const client = getClient(deps.apiKey);
  const poiIds = new Set(request.pois.map((p) => p.id));
  const mapPoiIds = new Set((kb.surroundings ?? []).map((p) => p.id));
  // The find_place tool is only offered when the KB knows where the property
  // is — without coordinates there is nothing to search around.
  const tools = kb.location ? [FIND_PLACE_TOOL] : undefined;
  const outputConfig = {
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          focus: { type: ['string', 'null'] },
          // Id of a nearby place (kb.surroundings) the viewer's map should
          // route to, or null. Only meaningful for KBs with surroundings.
          mapPoi: { type: ['string', 'null'] },
          // True when the visitor asked about sizes/dimensions/fit — the
          // viewer glides to its bird's-eye view where the authored room
          // dimensions are overlaid (it ignores the flag when no dimensions
          // are authored for the scan).
          showDimensions: { type: 'boolean' },
          // True when the model answered with the fallback message (question
          // not covered by the KB) — the client renders contact buttons then.
          fallback: { type: 'boolean' },
        },
        required: ['answer', 'focus', 'mapPoi', 'showDimensions', 'fallback'],
        additionalProperties: false,
      },
    },
  };
  try {
    let message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      ...(tools ? { tools } : {}),
      output_config: outputConfig,
    } as Anthropic.MessageCreateParamsNonStreaming);

    const usageTotal = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
    };

    // Tool round: the model asked for a place lookup. Execute it server-side
    // and give the result back in a second call; tool_choice 'none' forces the
    // final structured answer (one lookup per question, no loops).
    let foundPlace: FoundPlace | null = null;
    if (message.stop_reason === 'tool_use' && kb.location) {
      const toolUse = message.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (toolUse) {
        const input = toolUse.input as { query?: unknown; category?: unknown };
        const query = typeof input.query === 'string' ? input.query : '';
        const category = typeof input.category === 'string' ? input.category : undefined;
        let toolResultContent: string;
        let isError = false;
        try {
          foundPlace = query.length > 0 || category
            ? await findPlace(query, kb.location, category)
            : null;
          toolResultContent = foundPlace
            ? JSON.stringify({
                name: foundPlace.name,
                address: foundPlace.address,
                walkMinutes: foundPlace.walkMinutes,
                driveMinutes: foundPlace.driveMinutes,
                distanceMeters: foundPlace.distanceMeters,
              })
            : 'No matching place found near the property.';
        } catch (lookupErr) {
          console.warn('[concierge] find_place failed:', String(lookupErr).slice(0, 200));
          toolResultContent = 'Place lookup unavailable right now.';
          isError = true;
        }

        message = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [
            ...messages,
            { role: 'assistant', content: message.content },
            {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: toolResultContent,
                ...(isError ? { is_error: true } : {}),
              }],
            },
          ],
          tools: [FIND_PLACE_TOOL],
          tool_choice: { type: 'none' },
          output_config: outputConfig,
        } as Anthropic.MessageCreateParamsNonStreaming);

        usageTotal.input_tokens += message.usage.input_tokens;
        usageTotal.output_tokens += message.usage.output_tokens;
        usageTotal.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
        usageTotal.cache_creation_input_tokens += message.usage.cache_creation_input_tokens ?? 0;
      }
    }

    // On a refusal stop reason, return the KB fallback rather than an empty or
    // unsafe answer. Default to the German fallback as the property's primary
    // language; the system prompt otherwise handles per-language fallbacks.
    if (message.stop_reason === 'refusal') {
      return {
        status: 200,
        body: { answer: kb.fallback.de, focus: null, mapPoi: null, mapPlace: null, showDimensions: false, fallback: true },
      };
    }

    const parsed = parseStructured(extractText(message.content), poiIds, mapPoiIds);
    const usedServerFallback = parsed.answer.length === 0;
    const finalAnswer = usedServerFallback ? kb.fallback.de : parsed.answer;

    // The searched place only rides along when the model actually answered
    // from it — on a fallback answer a map to the place would contradict the
    // "I don't know" text. Same for a dimensions answer: Haiku sometimes
    // calls find_place on a plain size question ("wie groß ist der Raum?"),
    // and the stray place must not hijack the camera action — the visitor
    // asked about the room, so the measurement view wins.
    const answeredFromPlace = foundPlace !== null && !parsed.fallback && !usedServerFallback &&
      !parsed.showDimensions;

    return {
      status: 200,
      body: {
        answer: finalAnswer,
        focus: parsed.focus,
        mapPoi: parsed.mapPoi,
        // Live-searched place for the viewer's neighbourhood map: it draws the
        // route to these coordinates (they never enter the model's context).
        mapPlace: answeredFromPlace && foundPlace
          ? { name: foundPlace.name, address: foundPlace.address, lngLat: foundPlace.lngLat }
          : null,
        // A size/dimension question flies to the bird's-eye measurement view
        // regardless of whether the text could cite the exact number: the
        // overlaid room measurements ARE the answer. So this is decoupled from
        // `parsed.fallback` on purpose — the model sometimes falls back on a
        // borderline size question (e.g. "wie groß ist die Wand?"), and the
        // measurement overlay is exactly what helps there. On such a fallback
        // the model also occasionally drops `showDimensions` itself, so we back
        // it up with an intent match on the visitor's own words. Still
        // suppressed on a server-side fallback (empty/unparseable model
        // output), which is a genuine error rather than a real answer.
        showDimensions:
          (parsed.showDimensions ||
            (parsed.fallback && DIMENSION_INTENT_RE.test(lastUserText(request.messages)))) &&
          !usedServerFallback,
        fallback: parsed.fallback || usedServerFallback,
        usage: usageTotal,
      },
    };
  } catch (err) {
    // 6. Typed error mapping. Log BEFORE mapping — a broken API key, a model
    //    deprecation and a network timeout must be distinguishable in the
    //    worker logs (the visitor always just sees "temporarily unavailable").
    if (err instanceof Anthropic.RateLimitError) {
      console.warn('[concierge] upstream 429 rate limit');
      return { status: 429, body: { error: 'Upstream rate limit. Please retry shortly.' } };
    }
    if (err instanceof Anthropic.APIError) {
      console.warn(`[concierge] Anthropic ${err.status} ${err.name}:`, String(err.message).slice(0, 300));
      return { status: 502, body: { error: 'The concierge is temporarily unavailable.' } };
    }
    console.warn('[concierge] request failed:', String(err).slice(0, 300));
    return { status: 502, body: { error: 'The concierge is temporarily unavailable.' } };
  }
}

/** Read the first text block from a Claude message's content array. */
function extractText(content: Anthropic.ContentBlock[]): string {
  for (const block of content) {
    if (block.type === 'text') {
      return block.text.trim();
    }
  }
  return '';
}

/**
 * Parse the structured { answer, focus, mapPoi, showDimensions, fallback }
 * JSON. `focus` is only honoured when it is one of the ids the client offered,
 * `mapPoi` only when it names a place in the KB's surroundings list (so the
 * model can't point the camera or the map at something that doesn't exist);
 * anything else becomes null.
 */
function parseStructured(
  text: string,
  poiIds: Set<string>,
  mapPoiIds: Set<string>,
): { answer: string; focus: string | null; mapPoi: string | null; showDimensions: boolean; fallback: boolean } {
  try {
    const obj = JSON.parse(text) as {
      answer?: unknown; focus?: unknown; mapPoi?: unknown; showDimensions?: unknown; fallback?: unknown;
    };
    const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
    const focus = typeof obj.focus === 'string' && poiIds.has(obj.focus) ? obj.focus : null;
    const mapPoi = typeof obj.mapPoi === 'string' && mapPoiIds.has(obj.mapPoi) ? obj.mapPoi : null;
    const showDimensions = obj.showDimensions === true;
    const fallback = obj.fallback === true;
    return { answer, focus, mapPoi, showDimensions, fallback };
  } catch {
    // Not valid JSON (shouldn't happen with structured output) — treat the raw
    // text as the answer, no focus.
    return { answer: text, focus: null, mapPoi: null, showDimensions: false, fallback: false };
  }
}
