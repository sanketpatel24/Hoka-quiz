import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import earlyAccess from '../api/early-access.js';
import health from '../api/health.js';
import index from '../api/index.js';
import configTest from '../api/test.js';
import { clearTokenCache } from '../lib/shopify.js';
import {
  API_SECRET,
  CUSTOMER_ID,
  ENTRY_ID,
  STORE_DOMAIN,
  STOREFRONT_ORIGIN,
  clearEnv,
  proxyUrl,
  setEnv,
  stubShopify,
  validForm,
} from './helpers.js';

let shopify;

beforeEach(() => {
  setEnv();
  clearTokenCache();
  shopify = stubShopify();
});

afterEach(() => {
  shopify.restore();
  clearEnv();
});

const post = (url, body, headers = {}) => earlyAccess.fetch(new Request(url, { method: 'POST', body, headers }));

const graphqlCall = (name) => shopify.graphqlBodies().find(({ query }) => query.includes(name));

const upsertFieldsByKey = () =>
  Object.fromEntries(graphqlCall('metaobjectUpsert').variables.metaobject.fields.map(({ key, value }) => [key, value]));

test('creates the submission entry with every answer and links it to the customer', async () => {
  const response = await post(proxyUrl(), validForm());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.screenshotSaved, true);
  assert.deepEqual(body.answers.surfaces, ['road', 'trail']);

  const upsert = graphqlCall('metaobjectUpsert');
  assert.deepEqual(upsert.variables.handle, { type: 'early_access_submission', handle: `customer-${CUSTOMER_ID}` });
  assert.deepEqual(upsertFieldsByKey(), {
    pass_number: body.passNumber,
    weekly_distance: '10-25-km',
    surfaces: '["road","trail"]',
    goal: 'half-marathon',
    shoe_fit: 'mens',
    shoe_size: '9',
    submitted_at: body.submittedAt,
    run_screenshot: 'gid://shopify/MediaImage/555',
  });

  assert.deepEqual(graphqlCall('metafieldsSet').variables.metafields, [
    {
      ownerId: `gid://shopify/Customer/${CUSTOMER_ID}`,
      namespace: 'early_access',
      key: 'submission',
      type: 'metaobject_reference',
      value: ENTRY_ID,
    },
  ]);

  const upload = shopify.calls.find(({ url }) => url === 'https://uploads.test/upload');
  assert.equal(upload.init.body.get('key'), 'tmp/run.png');
  assert.equal(upload.init.body.get('file').size, 12);
});

test('creates the entry before linking it to the customer', async () => {
  await post(proxyUrl(), validForm({ withScreenshot: false }));
  const order = shopify.graphqlBodies().map(({ query }) =>
    query.includes('metaobjectUpsert') ? 'upsert' : query.includes('metafieldsSet') ? 'link' : 'other',
  );
  assert.deepEqual(order, ['upsert', 'link']);
});

test('leaves the previous screenshot in place when no new one is sent', async () => {
  const response = await post(proxyUrl(), validForm({ withScreenshot: false }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.screenshotSaved, false);
  assert.equal(shopify.calls.some(({ url }) => url.startsWith('https://uploads.test')), false);
  assert.equal(Object.hasOwn(upsertFieldsByKey(), 'run_screenshot'), false);
});

test('answers 502 and does not link the customer when the entry is rejected', async () => {
  const stubbed = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/graphql.json') && JSON.parse(init.body).query.includes('metaobjectUpsert')) {
      shopify.calls.push({ url: String(url), init });
      return Response.json({
        data: {
          metaobjectUpsert: {
            metaobject: null,
            userErrors: [{ field: ['handle'], message: 'No metaobject definition exists for type', code: 'UNDEFINED_OBJECT_TYPE' }],
          },
        },
      });
    }
    return stubbed(url, init);
  };

  const response = await post(proxyUrl(), validForm({ withScreenshot: false }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(body, { ok: false, error: 'Could not save your answers' });
  assert.equal(graphqlCall('metafieldsSet'), undefined);
});

test('writes to the metaobject type and customer metafield named in the environment', async () => {
  process.env.EARLY_ACCESS_METAOBJECT_TYPE = 'quiz_entry';
  process.env.EARLY_ACCESS_CUSTOMER_METAFIELD = 'custom.quiz_entry';

  const response = await post(proxyUrl(), validForm({ withScreenshot: false }));
  assert.equal(response.status, 200);
  assert.equal(graphqlCall('metaobjectUpsert').variables.handle.type, 'quiz_entry');

  const [link] = graphqlCall('metafieldsSet').variables.metafields;
  assert.equal(link.namespace, 'custom');
  assert.equal(link.key, 'quiz_entry');
});

test('answers 503 without calling Shopify when the metaobject type is not configured', async () => {
  delete process.env.EARLY_ACCESS_METAOBJECT_TYPE;
  const response = await post(proxyUrl(), validForm());
  assert.equal(response.status, 503);
  assert.equal(shopify.calls.length, 0);
});

test('answers 503 when the customer metafield is not namespace.key', async () => {
  process.env.EARLY_ACCESS_CUSTOMER_METAFIELD = 'submission';
  const response = await post(proxyUrl(), validForm());
  assert.equal(response.status, 503);
  assert.equal(shopify.calls.length, 0);
});

test('accepts requests from every configured storefront origin, the myshopify origin, and none', async () => {
  for (const origin of [STOREFRONT_ORIGIN, 'https://early-access-test.example', `https://${STORE_DOMAIN}`, null]) {
    const response = await post(proxyUrl(), validForm({ withScreenshot: false }), origin ? { Origin: origin } : {});
    assert.equal(response.status, 200, `origin ${origin}`);
  }
});

test('refuses a request whose browser origin is another site', async () => {
  const response = await post(proxyUrl(), validForm(), { Origin: 'https://attacker.example' });
  assert.equal(response.status, 403);
  assert.equal(shopify.calls.length, 0);
});

test('refuses requests that did not come through the app proxy', async () => {
  const response = await post('https://metafields-api.test/api/early-access?logged_in_customer_id=1', validForm());
  assert.equal(response.status, 401);
  assert.equal(shopify.calls.length, 0);
});

test('refuses signed requests from another shop', async () => {
  const response = await post(proxyUrl({ shop: 'someone-else.myshopify.com' }), validForm());
  assert.equal(response.status, 401);
});

test('asks a logged-out shopper to sign in', async () => {
  const response = await post(proxyUrl({ customerId: '' }), validForm());
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, 'not_logged_in');
  assert.equal(shopify.calls.length, 0);
});

test('returns field errors for invalid answers without calling Shopify', async () => {
  const form = validForm();
  form.delete('goal');
  const response = await post(proxyUrl(), form);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 'invalid_answers');
  assert.deepEqual(body.fields, { goal: 'required' });
  assert.equal(shopify.calls.length, 0);
});

test('answers 502 without leaking Shopify errors when the save fails', async () => {
  shopify.restore();
  globalThis.fetch = async () => new Response('{"errors":"[API] Invalid API key or access token"}', { status: 401 });

  const response = await post(proxyUrl(), validForm({ withScreenshot: false }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(body, { ok: false, error: 'Could not save your answers' });
});

test('answers 503 when the deployment is missing its secret', async () => {
  delete process.env.SHOPIFY_API_SECRET;
  const response = await post(proxyUrl(), validForm());
  assert.equal(response.status, 503);
});

test('answers 405 with an Allow header for the wrong method', async () => {
  const response = await earlyAccess.fetch(new Request(proxyUrl()));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('health answers 200 with every secret missing', async () => {
  clearEnv();
  const response = await health.fetch(new Request('https://metafields-api.test/api/health'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('config test answers 503 and names the missing variables without values', async () => {
  delete process.env.SHOPIFY_API_KEY;
  const response = await configTest.fetch(new Request('https://metafields-api.test/api/test'));
  const text = await response.text();

  assert.equal(response.status, 503);
  assert.match(text, /"name":"SHOPIFY_API_KEY"[^}]*"status":"missing"/);
  assert.equal(text.includes(API_SECRET), false);
});

test('config test reports an invalid storefront origin without calling Shopify', async () => {
  process.env.SHOPIFY_STOREFRONT_ORIGIN = 'http://www.early-access-test.example';
  const response = await configTest.fetch(new Request('https://metafields-api.test/api/test'));
  const text = await response.text();

  assert.equal(response.status, 503);
  assert.match(text, /"name":"SHOPIFY_STOREFRONT_ORIGIN"[^}]*"status":"invalid"/);
  assert.equal(shopify.calls.length, 0);
});

test('config test answers 200 when Shopify grants the required scopes', async () => {
  shopify.restore();
  globalThis.fetch = async (url) =>
    String(url).endsWith('/access_token')
      ? Response.json({ access_token: 'shpat_test', expires_in: 86399 })
      : Response.json({
          data: {
            shop: { myshopifyDomain: 'early-access-test.myshopify.com' },
            currentAppInstallation: {
              accessScopes: [{ handle: 'write_customers' }, { handle: 'write_files' }, { handle: 'write_metaobjects' }],
            },
          },
        });

  const response = await configTest.fetch(new Request('https://metafields-api.test/api/test'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).upstream.ok, true);
});

test('config test answers 503 when the app cannot write metaobjects', async () => {
  shopify.restore();
  globalThis.fetch = async (url) =>
    String(url).endsWith('/access_token')
      ? Response.json({ access_token: 'shpat_test', expires_in: 86399 })
      : Response.json({
          data: {
            shop: { myshopifyDomain: 'early-access-test.myshopify.com' },
            currentAppInstallation: {
              accessScopes: [{ handle: 'write_customers' }, { handle: 'write_files' }],
            },
          },
        });

  const response = await configTest.fetch(new Request('https://metafields-api.test/api/test'));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.upstream.detail, /missing scopes: write_metaobjects/);
});

test('index lists every endpoint and env name but never a value', async () => {
  const response = await index.fetch(new Request('https://metafields-api.test/'));
  const html = await response.text();

  assert.equal(response.status, 200);
  const expectedNames = [
    'POST /api/early-access',
    '/api/test',
    '/api/health',
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_STOREFRONT_ORIGIN',
    'SHOPIFY_API_KEY',
    'SHOPIFY_API_SECRET',
    'EARLY_ACCESS_METAOBJECT_TYPE',
    'EARLY_ACCESS_CUSTOMER_METAFIELD',
  ];
  for (const expected of expectedNames) {
    assert.ok(html.includes(expected), `index is missing ${expected}`);
  }
  assert.equal(html.includes(API_SECRET), false);
});
