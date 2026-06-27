/**
 * Input validation + caps for the virtual-staging endpoint.
 *
 * Critical security property (same as the concierge): the request carries NO
 * prompt and NO style text — only a style *id* the server maps to its own
 * prompt. A client physically cannot smuggle prompt content into the model.
 * We validate the small fixed shape `{ propertyId, image, style? }`.
 */

/** The validated, trusted staging request. */
export interface StagingRequest {
  propertyId: string;
  /** Raw base64 of the source frame (no data: prefix), JPEG or PNG. */
  imageBase64: string;
  /** MIME type of the source frame. */
  mimeType: 'image/jpeg' | 'image/png';
  /** Selected style id (already known-safe is NOT guaranteed here; resolved later). */
  style: string | undefined;
  /** Captured frame pixel width, used to pick a matching output aspect. */
  width: number | undefined;
  /** Captured frame pixel height, used to pick a matching output aspect. */
  height: number | undefined;
}

/** Thrown for any malformed input; mapped to HTTP 400 by the core. */
export class StagingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingValidationError';
  }
}

const PROPERTY_ID_RE = /^[a-z0-9-]{1,64}$/;
const STYLE_ID_RE = /^[a-z0-9-]{1,32}$/;
// ~8 MB decoded image -> ~10.9M base64 chars. Cap a little above that.
const MAX_IMAGE_BASE64_CHARS = 12_000_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png));base64,(.+)$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an arbitrary parsed JSON body into a typed StagingRequest.
 * Accepts `image` either as a full data URL (`data:image/jpeg;base64,...`) or as
 * raw base64 plus an explicit `mimeType`. Throws StagingValidationError (=> 400).
 */
export function validateStagingRequest(body: unknown): StagingRequest {
  if (!isObject(body)) {
    throw new StagingValidationError('Request body must be a JSON object.');
  }

  const propertyId = body['propertyId'];
  if (typeof propertyId !== 'string' || !PROPERTY_ID_RE.test(propertyId)) {
    throw new StagingValidationError('Field "propertyId" must match ^[a-z0-9-]{1,64}$.');
  }

  const rawImage = body['image'];
  if (typeof rawImage !== 'string' || rawImage.length === 0) {
    throw new StagingValidationError('Field "image" must be a non-empty string.');
  }
  if (rawImage.length > MAX_IMAGE_BASE64_CHARS + 64) {
    throw new StagingValidationError('Field "image" is too large.');
  }

  let imageBase64: string;
  let mimeType: 'image/jpeg' | 'image/png';

  const dataUrlMatch = DATA_URL_RE.exec(rawImage);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1] as 'image/jpeg' | 'image/png';
    imageBase64 = dataUrlMatch[2];
  } else {
    // Raw base64: require an explicit mimeType field.
    const rawMime = body['mimeType'];
    if (rawMime !== 'image/jpeg' && rawMime !== 'image/png') {
      throw new StagingValidationError('Field "mimeType" must be "image/jpeg" or "image/png" when "image" is raw base64.');
    }
    mimeType = rawMime;
    imageBase64 = rawImage;
  }

  if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    throw new StagingValidationError('Image data is too large.');
  }
  if (!BASE64_RE.test(imageBase64)) {
    throw new StagingValidationError('Image data is not valid base64.');
  }

  const rawStyle = body['style'];
  let style: string | undefined;
  if (rawStyle === undefined || rawStyle === null) {
    style = undefined;
  } else if (typeof rawStyle === 'string' && STYLE_ID_RE.test(rawStyle)) {
    style = rawStyle;
  } else {
    throw new StagingValidationError('Field "style" must match ^[a-z0-9-]{1,32}$.');
  }

  const width = optionalDimension(body['width'], 'width');
  const height = optionalDimension(body['height'], 'height');

  return { propertyId, imageBase64, mimeType, style, width, height };
}

/** Validate an optional positive pixel dimension (1..16384). */
function optionalDimension(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 16384) {
    throw new StagingValidationError(`Field "${name}" must be a positive number up to 16384.`);
  }
  return Math.round(value);
}
