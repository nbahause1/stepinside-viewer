/**
 * Concierge end-to-end harness against the local dev server (real Haiku calls).
 *
 * Run:
 *   RATE_BURST=10 RATE_DAILY=40 npm run dev     # terminal 1 (small burst for the 429 test)
 *   node test-concierge.mjs                     # terminal 2
 *
 * Checks, in order:
 *   1. In-KB facts answer concretely (price, ceiling height).
 *   2. Out-of-KB question falls back to the broker message (no hallucination).
 *   3. English question gets an English answer.
 *   4. Focus: a window question returns focus:"window".
 *   5. Burst rate limit: hammering yields 429 with reason:"burst".
 */

const ENDPOINT = 'http://localhost:8787/concierge';
const PROPERTY = 'altbau-eppendorf';
const POIS = [
  { id: 'window', label: 'Fenster', keywords: ['fenster', 'window'] },
  { id: 'door', label: 'Tür', keywords: ['tür', 'door'] },
];

let failures = 0;

function check(name, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${ok ? '' : `\n      ${detail}`}`);
  if (!ok) failures += 1;
}

async function ask(content) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      propertyId: PROPERTY,
      messages: [{ role: 'user', content }],
      room: null,
      pois: POIS,
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// --- 1. In-KB facts ---------------------------------------------------------
{
  const { status, body } = await ask('Was kostet die Wohnung?');
  check(
    'price answered from KB',
    status === 200 && /895\.?000/.test(body.answer ?? ''),
    `status=${status} answer=${JSON.stringify(body.answer)}`,
  );
}
{
  const { status, body } = await ask('Wie hoch sind die Decken?');
  check(
    'ceiling height answered from KB',
    status === 200 && /3,4|3\.4/.test(body.answer ?? ''),
    `status=${status} answer=${JSON.stringify(body.answer)}`,
  );
}

// --- 2. Out-of-KB -> broker fallback, no invention --------------------------
{
  const { status, body } = await ask('Gibt es einen Aufzug im Haus?');
  const a = body.answer ?? '';
  check(
    'out-of-KB question points to the broker (no invented elevator fact)',
    status === 200 && /Bergmann|Makler|040 555/.test(a) && !/ja, es gibt einen aufzug/i.test(a),
    `status=${status} answer=${JSON.stringify(a)}`,
  );
}

// --- 3. Language matching ---------------------------------------------------
{
  const { status, body } = await ask('How high are the ceilings?');
  const a = body.answer ?? '';
  check(
    'English question gets an English answer with the fact',
    status === 200 && /3\.4|3,4/.test(a) && /ceiling|high|approx/i.test(a),
    `status=${status} answer=${JSON.stringify(a)}`,
  );
}

// --- 4. Focus target --------------------------------------------------------
{
  const { status, body } = await ask('Zeig mir mal die Fenster. Wie groß sind die?');
  check(
    'window question sets focus:"window"',
    status === 200 && body.focus === 'window',
    `status=${status} focus=${JSON.stringify(body.focus)} answer=${JSON.stringify(body.answer)}`,
  );
}

// --- 5. Burst limit -> 429 reason:"burst" (invalid bodies, no model cost) ----
{
  let last = null;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'nope!' }), // fails validation AFTER the rate check
    });
    last = { status: res.status, body: await res.json(), retryAfter: res.headers.get('retry-after') };
    if (res.status === 429) break;
  }
  check(
    'hammering trips the burst limiter with reason:"burst" + Retry-After',
    last?.status === 429 && last?.body?.reason === 'burst' && last?.retryAfter !== null,
    JSON.stringify(last),
  );
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
