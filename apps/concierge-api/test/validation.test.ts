/**
 * Validation matrix for the staging endpoint (staging-validation.ts) and the
 * analytics /events + /lead bodies (analytics.ts). These are the request
 * gates in front of the paid model call and the D1 writes — every rejection
 * here is a rejection the production worker performs identically.
 */
import { describe, it, expect } from 'vitest';
import { validateStagingRequest, StagingValidationError } from '../src/staging-validation.js';
import { validateEventsRequest, validateLeadRequest, EVENT_TYPES } from '../src/analytics.js';
import { ValidationError } from '../src/validation.js';

const B64 = 'AAAA'; // minimal valid base64 payload

describe('validateStagingRequest', () => {
  it('accepts a data-URL jpeg image without explicit mimeType', () => {
    const req = validateStagingRequest({
      propertyId: 'prop-1',
      image: `data:image/jpeg;base64,${B64}`,
    });
    expect(req.propertyId).toBe('prop-1');
    expect(req.mimeType).toBe('image/jpeg');
    expect(req.imageBase64).toBe(B64);
    expect(req.style).toBeUndefined();
    expect(req.width).toBeUndefined();
    expect(req.height).toBeUndefined();
  });

  it('accepts a data-URL png image', () => {
    const req = validateStagingRequest({
      propertyId: 'prop-1',
      image: `data:image/png;base64,${B64}`,
    });
    expect(req.mimeType).toBe('image/png');
  });

  it('accepts raw base64 with explicit mimeType', () => {
    const req = validateStagingRequest({
      propertyId: 'prop-1',
      image: B64,
      mimeType: 'image/png',
    });
    expect(req.mimeType).toBe('image/png');
    expect(req.imageBase64).toBe(B64);
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, undefined, 'str', 42, [], true]) {
      expect(() => validateStagingRequest(body)).toThrow(StagingValidationError);
      expect(() => validateStagingRequest(body)).toThrow('Request body must be a JSON object.');
    }
  });

  describe('propertyId', () => {
    const base = { image: `data:image/jpeg;base64,${B64}` };
    it.each([
      ['missing', undefined],
      ['non-string', 5],
      ['empty', ''],
      ['uppercase', 'Prop-1'],
      ['underscore', 'prop_1'],
      ['too long (65)', 'a'.repeat(65)],
      ['path traversal', '../etc'],
    ])('rejects %s', (_label, propertyId) => {
      expect(() => validateStagingRequest({ ...base, propertyId })).toThrow(
        'Field "propertyId" must match ^[a-z0-9-]{1,64}$.',
      );
    });
    it('accepts a 64-char id', () => {
      const req = validateStagingRequest({ ...base, propertyId: 'a'.repeat(64) });
      expect(req.propertyId).toBe('a'.repeat(64));
    });
  });

  describe('image / mimeType', () => {
    it('rejects a missing or empty image', () => {
      expect(() => validateStagingRequest({ propertyId: 'p' })).toThrow(
        'Field "image" must be a non-empty string.',
      );
      expect(() => validateStagingRequest({ propertyId: 'p', image: '' })).toThrow(
        'Field "image" must be a non-empty string.',
      );
    });

    it('rejects raw base64 without a mimeType', () => {
      expect(() => validateStagingRequest({ propertyId: 'p', image: B64 })).toThrow(
        'Field "mimeType" must be "image/jpeg" or "image/png" when "image" is raw base64.',
      );
    });

    it('rejects mimeTypes outside the jpeg/png whitelist', () => {
      for (const mimeType of ['image/gif', 'image/webp', 'text/html', 'image/svg+xml']) {
        expect(() => validateStagingRequest({ propertyId: 'p', image: B64, mimeType })).toThrow(
          'Field "mimeType" must be "image/jpeg" or "image/png" when "image" is raw base64.',
        );
      }
    });

    it('rejects a data URL with a non-whitelisted mime (falls to the raw-base64 path)', () => {
      // data:image/webp does not match the data-URL regex, so the string is
      // treated as raw base64 — and without a mimeType field it is rejected.
      expect(() =>
        validateStagingRequest({ propertyId: 'p', image: `data:image/webp;base64,${B64}` }),
      ).toThrow('Field "mimeType" must be "image/jpeg" or "image/png" when "image" is raw base64.');
    });

    it('rejects an oversized image string (outer cap)', () => {
      const image = 'A'.repeat(12_000_000 + 65);
      expect(() => validateStagingRequest({ propertyId: 'p', image })).toThrow(
        'Field "image" is too large.',
      );
    });

    it('rejects oversized base64 inside a data URL (inner cap)', () => {
      // Payload passes the outer cap (prefix + payload < cap + 64) but the
      // extracted base64 exceeds MAX_IMAGE_BASE64_CHARS.
      const image = `data:image/jpeg;base64,${'A'.repeat(12_000_004)}`;
      expect(() => validateStagingRequest({ propertyId: 'p', image })).toThrow(
        'Image data is too large.',
      );
    });

    it('rejects strings that are not valid base64', () => {
      expect(() =>
        validateStagingRequest({ propertyId: 'p', image: 'not base64!!', mimeType: 'image/jpeg' }),
      ).toThrow('Image data is not valid base64.');
    });
  });

  describe('style', () => {
    const base = { propertyId: 'p', image: `data:image/jpeg;base64,${B64}` };
    it('passes through a valid style id and maps null/undefined to undefined', () => {
      expect(validateStagingRequest({ ...base, style: 'scandi-1' }).style).toBe('scandi-1');
      expect(validateStagingRequest({ ...base, style: null }).style).toBeUndefined();
      expect(validateStagingRequest({ ...base }).style).toBeUndefined();
    });
    it.each([
      ['uppercase', 'Scandi'],
      ['too long (33)', 'a'.repeat(33)],
      ['non-string', 7],
      ['empty', ''],
    ])('rejects %s', (_label, style) => {
      expect(() => validateStagingRequest({ ...base, style })).toThrow(
        'Field "style" must match ^[a-z0-9-]{1,32}$.',
      );
    });
  });

  describe('width / height (optional dimensions)', () => {
    const base = { propertyId: 'p', image: `data:image/jpeg;base64,${B64}` };
    it('accepts valid dimensions and rounds them', () => {
      const req = validateStagingRequest({ ...base, width: 1919.6, height: 1080 });
      expect(req.width).toBe(1920);
      expect(req.height).toBe(1080);
    });
    it('treats null/undefined as absent', () => {
      const req = validateStagingRequest({ ...base, width: null });
      expect(req.width).toBeUndefined();
    });
    it.each([
      ['zero', 0],
      ['negative', -1],
      ['too large', 16385],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['string', '1920'],
    ])('rejects width %s', (_label, width) => {
      expect(() => validateStagingRequest({ ...base, width })).toThrow(
        'Field "width" must be a positive number up to 16384.',
      );
    });
    it('rejects an invalid height with the height-specific message', () => {
      expect(() => validateStagingRequest({ ...base, height: 0 })).toThrow(
        'Field "height" must be a positive number up to 16384.',
      );
    });
    it('accepts the 16384 boundary', () => {
      expect(validateStagingRequest({ ...base, width: 16384 }).width).toBe(16384);
    });
  });
});

const SESSION = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('validateEventsRequest', () => {
  const valid = {
    propertyId: 'prop-1',
    sessionId: SESSION,
    events: [{ type: 'open' }],
  };

  it('accepts a minimal valid batch', () => {
    const req = validateEventsRequest(valid);
    expect(req.propertyId).toBe('prop-1');
    expect(req.sessionId).toBe(SESSION);
    expect(req.events).toEqual([{ type: 'open', data: null }]);
  });

  it('accepts every whitelisted event type', () => {
    for (const type of EVENT_TYPES) {
      const req = validateEventsRequest({ ...valid, events: [{ type }] });
      expect(req.events[0].type).toBe(type);
    }
  });

  it('rejects event types outside the whitelist', () => {
    for (const type of ['click', 'OPEN', 'purchase', '', 42, null]) {
      expect(() => validateEventsRequest({ ...valid, events: [{ type }] })).toThrow(
        'events[0].type is not an allowed event type.',
      );
    }
  });

  it('rejects invalid sessionIds', () => {
    for (const sessionId of ['short', 'ABCDEF1234', 'g1b2c3d4-e5f6', 'a'.repeat(65), 42]) {
      expect(() => validateEventsRequest({ ...valid, sessionId })).toThrow(
        'Field "sessionId" must match ^[a-f0-9-]{8,64}$.',
      );
    }
  });

  it('rejects invalid propertyIds', () => {
    expect(() => validateEventsRequest({ ...valid, propertyId: 'Prop!' })).toThrow(
      'Field "propertyId" must match ^[a-z0-9-]{1,64}$.',
    );
  });

  it('rejects empty and non-array events', () => {
    expect(() => validateEventsRequest({ ...valid, events: [] })).toThrow(
      'Field "events" must be a non-empty array.',
    );
    expect(() => validateEventsRequest({ ...valid, events: 'open' })).toThrow(
      'Field "events" must be a non-empty array.',
    );
  });

  it('accepts exactly 20 events but rejects 21', () => {
    const twenty = Array.from({ length: 20 }, () => ({ type: 'heartbeat' }));
    expect(validateEventsRequest({ ...valid, events: twenty }).events).toHaveLength(20);
    const twentyOne = [...twenty, { type: 'heartbeat' }];
    expect(() => validateEventsRequest({ ...valid, events: twentyOne })).toThrow(
      'Too many events (max 20).',
    );
  });

  it('serializes event data as JSON and enforces the 500-char cap', () => {
    const req = validateEventsRequest({
      ...valid,
      events: [{ type: 'heartbeat', data: { seconds: 12 } }],
    });
    expect(req.events[0].data).toBe('{"seconds":12}');

    expect(() =>
      validateEventsRequest({
        ...valid,
        events: [{ type: 'heartbeat', data: { blob: 'x'.repeat(600) } }],
      }),
    ).toThrow('events[0].data exceeds 500 JSON characters.');
  });

  it('reports the index of the offending event', () => {
    expect(() =>
      validateEventsRequest({ ...valid, events: [{ type: 'open' }, { type: 'nope' }] }),
    ).toThrow('events[1].type is not an allowed event type.');
  });

  it('throws ValidationError instances (mapped to 400 by the entry points)', () => {
    expect(() => validateEventsRequest({})).toThrow(ValidationError);
  });
});

describe('validateLeadRequest', () => {
  const valid = {
    propertyId: 'prop-1',
    consent: true,
    name: 'Max Mustermann',
    contact: 'max@example.com',
  };

  it('accepts a minimal valid lead', () => {
    const req = validateLeadRequest(valid);
    expect(req).toEqual({
      propertyId: 'prop-1',
      name: 'Max Mustermann',
      contact: 'max@example.com',
      message: null,
      interest: null,
      timeframe: null,
    });
  });

  it('requires consent to be the LITERAL boolean true', () => {
    // GDPR: "true" as a string, 1, or truthy objects must NOT count as consent.
    for (const consent of ['true', 1, 'yes', {}, [], 'TRUE', undefined, null, false]) {
      expect(() => validateLeadRequest({ ...valid, consent })).toThrow(
        'Field "consent" must be true.',
      );
    }
  });

  it('trims name/contact and enforces their caps', () => {
    const req = validateLeadRequest({ ...valid, name: '  Max  ', contact: ' m@x.de ' });
    expect(req.name).toBe('Max');
    expect(req.contact).toBe('m@x.de');

    expect(() => validateLeadRequest({ ...valid, name: '' })).toThrow(
      'Field "name" must be 1–120 characters.',
    );
    expect(() => validateLeadRequest({ ...valid, name: '   ' })).toThrow(
      'Field "name" must be 1–120 characters.',
    );
    expect(() => validateLeadRequest({ ...valid, name: 'a'.repeat(121) })).toThrow(
      'Field "name" must be 1–120 characters.',
    );
    expect(() => validateLeadRequest({ ...valid, contact: '' })).toThrow(
      'Field "contact" must be 1–200 characters.',
    );
    expect(() => validateLeadRequest({ ...valid, contact: 'a'.repeat(201) })).toThrow(
      'Field "contact" must be 1–200 characters.',
    );
  });

  it('enforces the message cap and maps blank messages to null', () => {
    expect(validateLeadRequest({ ...valid, message: '  hello  ' }).message).toBe('hello');
    expect(validateLeadRequest({ ...valid, message: '   ' }).message).toBeNull();
    expect(validateLeadRequest({ ...valid, message: null }).message).toBeNull();
    expect(() => validateLeadRequest({ ...valid, message: 'a'.repeat(2001) })).toThrow(
      'Field "message" must be a string up to 2000 characters.',
    );
    expect(() => validateLeadRequest({ ...valid, message: 42 })).toThrow(
      'Field "message" must be a string up to 2000 characters.',
    );
  });

  it('enforces the interest cap and maps blank interest to null', () => {
    expect(validateLeadRequest({ ...valid, interest: 'Besichtigung' }).interest).toBe('Besichtigung');
    expect(validateLeadRequest({ ...valid, interest: '  ' }).interest).toBeNull();
    expect(() => validateLeadRequest({ ...valid, interest: 'a'.repeat(101) })).toThrow(
      'Field "interest" must be a string up to 100 characters.',
    );
  });

  it('rejects invalid propertyIds', () => {
    expect(() => validateLeadRequest({ ...valid, propertyId: 'NO' })).toThrow(
      'Field "propertyId" must match ^[a-z0-9-]{1,64}$.',
    );
  });
});
