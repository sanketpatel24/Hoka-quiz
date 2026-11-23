export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 3 * 1024 * 1024;

export const MAX_YEARLY_DISTANCE_KM = 20000;
export const YEARLY_DISTANCE_DECIMALS = 2;

const MAX_SURFACES = 10;
const ANSWER_HANDLE_MAX_LENGTH = 64;
const ANSWER_HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YEARLY_DISTANCE_PATTERN = new RegExp(`^\\d{1,5}(?:\\.\\d{1,${YEARLY_DISTANCE_DECIMALS}})?$`);
const CUSTOMER_ID_PATTERN = /^[1-9]\d{0,19}$/;

const IMAGE_FORMATS = {
  'image/png': { extension: 'png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  'image/jpeg': { extension: 'jpg', signature: [0xff, 0xd8, 0xff] },
};

function isAnswerHandle(value) {
  return value.length <= ANSWER_HANDLE_MAX_LENGTH && ANSWER_HANDLE_PATTERN.test(value);
}

function readText(formData, field) {
  const value = formData.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function readHandle(formData, field, errors) {
  const value = readText(formData, field);
  if (!value) errors[field] = 'required';
  else if (!isAnswerHandle(value)) errors[field] = 'invalid';
  return value;
}

function readSurfaces(formData, errors) {
  const values = [
    ...new Set(
      formData
        .getAll('surfaces')
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  if (!values.length) errors.surfaces = 'required';
  else if (values.length > MAX_SURFACES || !values.every(isAnswerHandle)) errors.surfaces = 'invalid';
  return values;
}

function readYearlyDistance(formData, errors) {
  const field = 'yearly_distance_km';
  const value = readText(formData, field);
  if (!value) {
    errors[field] = 'required';
    return null;
  }

  const kilometres = Number(value);
  if (!YEARLY_DISTANCE_PATTERN.test(value) || kilometres > MAX_YEARLY_DISTANCE_KM) {
    errors[field] = 'invalid';
    return null;
  }
  return kilometres;
}

async function readScreenshot(formData, errors) {
  const field = 'yearly_distance_screenshot';
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return null;

  const format = Object.hasOwn(IMAGE_FORMATS, file.type) ? IMAGE_FORMATS[file.type] : null;
  if (!format) {
    errors[field] = 'unsupported_type';
    return null;
  }

  if (file.size > MAX_SCREENSHOT_BYTES) {
    errors[field] = 'too_large';
    return null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!format.signature.every((byte, index) => bytes[index] === byte)) {
    errors[field] = 'unsupported_type';
    return null;
  }

  return { bytes, mimeType: file.type, extension: format.extension };
}

export function readCustomerId(formData) {
  const value = readText(formData, 'customerId');
  return CUSTOMER_ID_PATTERN.test(value) ? value : null;
}

export async function parseSubmission(formData) {
  const errors = {};

  const answers = {
    yearly_distance_km: readYearlyDistance(formData, errors),
    surfaces: readSurfaces(formData, errors),
    goal: readHandle(formData, 'goal', errors),
  };

  const screenshot = await readScreenshot(formData, errors);

  return Object.keys(errors).length
    ? { errors }
    : { answers, screenshot, errors: null };
}
