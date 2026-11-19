import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SIGNATURE_AGE_SECONDS, signProxyParams, verifyProxyRequest } from '../lib/app-proxy.js';
import { API_SECRET, CUSTOMER_ID, STORE_DOMAIN, proxyUrl } from './helpers.js';

test('matches the signature example from the Shopify app proxy docs', () => {
  const params = new URLSearchParams(
    'extra=1&extra=2&shop=shop-name.myshopify.com&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555',
  );
  assert.equal(
    signProxyParams(params, 'hush'),
    'a9718877bea71c2484f91608a7eaea1532bdf71f5c56825065fa4ccabe549ef3',
  );
});

test('accepts a correctly signed request and returns the customer', () => {
  const result = verifyProxyRequest(proxyUrl(), API_SECRET);
  assert.deepEqual(result, { valid: true, shop: STORE_DOMAIN, customerId: CUSTOMER_ID });
});

test('returns no customer when the shopper is logged out', () => {
  const result = verifyProxyRequest(proxyUrl({ customerId: '' }), API_SECRET);
  assert.equal(result.valid, true);
  assert.equal(result.customerId, null);
});

test('rejects a request signed with another secret', () => {
  const result = verifyProxyRequest(proxyUrl({ secret: 'other-secret' }), API_SECRET);
  assert.deepEqual(result, { valid: false, reason: 'signature mismatch' });
});

test('rejects a request whose customer id was swapped after signing', () => {
  const tampered = proxyUrl().replace(CUSTOMER_ID, '1');
  assert.equal(verifyProxyRequest(tampered, API_SECRET).valid, false);
});

test('rejects a signed request that carries a second customer id', () => {
  const params = new URLSearchParams({ shop: STORE_DOMAIN, timestamp: String(Math.floor(Date.now() / 1000)) });
  params.append('logged_in_customer_id', '1');
  params.append('logged_in_customer_id', CUSTOMER_ID);
  params.set('signature', signProxyParams(params, API_SECRET));
  const result = verifyProxyRequest(`https://metafields-api.test/api/early-access?${params}`, API_SECRET);
  assert.deepEqual(result, { valid: false, reason: 'duplicated proxy parameter' });
});

test('rejects a request with no signature', () => {
  const url = 'https://metafields-api.test/api/early-access?shop=x.myshopify.com&logged_in_customer_id=1';
  assert.equal(verifyProxyRequest(url, API_SECRET).reason, 'missing or malformed signature');
});

test('rejects a replayed request older than the allowed window', () => {
  const stale = Math.floor(Date.now() / 1000) - MAX_SIGNATURE_AGE_SECONDS - 1;
  assert.equal(verifyProxyRequest(proxyUrl({ timestamp: stale }), API_SECRET).reason, 'signature expired');
});
