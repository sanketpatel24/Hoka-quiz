import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_SIGNATURE_AGE_SECONDS = 300;

const SINGLE_VALUE_PARAMS = ['shop', 'logged_in_customer_id', 'path_prefix', 'timestamp', 'signature'];
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const CUSTOMER_ID_PATTERN = /^\d+$/;

export function signProxyParams(params, secret) {
  const grouped = new Map();
  for (const [key, value] of params) {
    if (key === 'signature') continue;
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }

  const message = [...grouped]
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .sort()
    .join('');

  return createHmac('sha256', secret).update(message).digest('hex');
}

export function verifyProxyRequest(requestUrl, secret, nowMs = Date.now()) {
  const params = new URL(requestUrl).searchParams;

  if (SINGLE_VALUE_PARAMS.some((name) => params.getAll(name).length > 1)) {
    return { valid: false, reason: 'duplicated proxy parameter' };
  }

  const signature = params.get('signature') ?? '';

  if (!SIGNATURE_PATTERN.test(signature)) {
    return { valid: false, reason: 'missing or malformed signature' };
  }

  const expected = Buffer.from(signProxyParams(params, secret), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    return { valid: false, reason: 'signature mismatch' };
  }

  const timestamp = Number(params.get('timestamp'));
  const ageSeconds = Math.abs(nowMs / 1000 - timestamp);
  if (!Number.isFinite(timestamp) || ageSeconds > MAX_SIGNATURE_AGE_SECONDS) {
    return { valid: false, reason: 'signature expired' };
  }

  const customerId = params.get('logged_in_customer_id') ?? '';

  return {
    valid: true,
    shop: params.get('shop') ?? '',
    customerId: CUSTOMER_ID_PATTERN.test(customerId) ? customerId : null,
  };
}
