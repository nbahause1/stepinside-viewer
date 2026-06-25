/**
 * Framework-agnostic concierge brain.
 *
 * handleConcierge does NO Node/Workers I/O in its signature: all environment
 * access (api key, KB loading, rate limiter, client ip) is injected via `deps`,
 * so the same function runs verbatim on Cloudflare Workers, Vercel, and the
 * local Node dev server.
 *
 * Order of operations:
 *   1. Rate-limit (per clientIp) -> 429 before any work.
 *   2. Validate input caps -> 400.
 *   3. Load knowledge for propertyId -> 400 if unknown.
 *   4. Build system blocks (rules + cached KB).
 *   5. Call claude-haiku-4-5 (non-streaming, max_tokens 400).
 *   6. Return { status, body }. Errors mapped: RateLimitError->429, APIError->502.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { KnowledgeLoader } from './knowledge.js';
import type { RateLimiter } from './ratelimit.js';
import { validateRequest, ValidationError } from './validation.js';
import { buildSystemBlocks, buildRoomContextLine } from './prompt.js';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 400;

/** Dependencies injected by each entry point. */
export interface ConciergeDeps {
  apiKey: string;
  loadKnowledge: KnowledgeLoader;
  rateLimiter: RateLimiter;
  /** Best-effort client IP for rate limiting; '' if unknown. */
  clientIp: string;
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
    return {
      status: 429,
      body: { error: 'Too many requests. Please slow down.' },
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
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              answer: { type: 'string' },
              focus: { type: ['string', 'null'] },
            },
            required: ['answer', 'focus'],
            additionalProperties: false,
          },
        },
      },
    } as Anthropic.MessageCreateParamsNonStreaming);

    // On a refusal stop reason, return the KB fallback rather than an empty or
    // unsafe answer. Default to the German fallback as the property's primary
    // language; the system prompt otherwise handles per-language fallbacks.
    if (message.stop_reason === 'refusal') {
      return { status: 200, body: { answer: kb.fallback.de, focus: null } };
    }

    const parsed = parseStructured(extractText(message.content), poiIds);
    const finalAnswer = parsed.answer.length > 0 ? parsed.answer : kb.fallback.de;

    return {
      status: 200,
      body: {
        answer: finalAnswer,
        focus: parsed.focus,
        usage: {
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
        },
      },
    };
  } catch (err) {
    // 6. Typed error mapping.
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, body: { error: 'Upstream rate limit. Please retry shortly.' } };
    }
    if (err instanceof Anthropic.APIError) {
      return { status: 502, body: { error: 'The concierge is temporarily unavailable.' } };
    }
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
 * Parse the structured { answer, focus } JSON. `focus` is only honoured when it
 * is one of the ids the client offered (so the model can't point the camera at
 * something that doesn't exist); anything else becomes null.
 */
function parseStructured(text: string, poiIds: Set<string>): { answer: string; focus: string | null } {
  try {
    const obj = JSON.parse(text) as { answer?: unknown; focus?: unknown };
    const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
    const focus = typeof obj.focus === 'string' && poiIds.has(obj.focus) ? obj.focus : null;
    return { answer, focus };
  } catch {
    // Not valid JSON (shouldn't happen with structured output) — treat the raw
    // text as the answer, no focus.
    return { answer: text, focus: null };
  }
}
