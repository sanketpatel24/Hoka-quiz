import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import earlyAccess from '../api/early-access.js';
import health from '../api/health.js';
import index from '../api/index.js';
import configTest from '../api/test.js';
import {
  ADMIN_TOKEN,
  API_URL,
  CUSTOMER_ID,
  CUSTOMER_TICKET,
  ENTRY_ID,
  STORE_DOMAIN,
  STOREFRONT_ORIGIN,
  clearEnv,
  setEnv,
  stubShopify,
  validForm,
} from './helpers.js';

let shopify;

beforeEach(() => {
  setEnv();
  shopify = stubShopify();
});

afterEach(() => {
  shopify.restore();
  clearEnv();
});

const FROM_STOREFRONT = { Origin: STOREFRONT_ORIGIN };

const post = (body, headers = FROM_STOREFRONT) =>
  earlyAccess.fetch(new Request(API_URL, { method: 'POST', body, headers }));

const graphqlCall = (name) => shopify.graphqlBodies().find(({ query }) => query.includes(name));

const upsertFieldsByKey = () =>
  Object.fromEntries(graphqlCall('metaobjectUpsert').variables.metaobject.fields.map(({ key, value }) => [key, value]));

test('stores the ticket number, the three answers and the screenshot, then links the entry', async () => {
  const response = await post(validForm());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    ticketNumber: CUSTOMER_TICKET,
    answers: { yearly_distance_km: 850.5, surfaces: ['road', 'trail'], goal: 'half-marathon' },
    screenshotSaved: true,
  });

  const upsert = graphqlCall('metaobjectUpsert');
  assert.deepEqual(upsert.variables.handle, { type: 'early_access_submission', handle: `customer-${CUSTOMER_ID}` });
  assert.deepEqual(upsertFieldsByKey(), {
    ticket_number: CUSTOMER_TICKET,
    yearly_distance_km: '850.5',
    surfaces: '["road","trail"]',
    goal: 'half-marathon',
    yearly_distance_screenshot: 'gid://shopify/MediaImage/555',
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

test('confirms the customer and reads their name, then creates the entry, then links it', async () => {
  await post(validForm({ withScreenshot: false }));
  const order = shopify.graphqlBodies().map(({ query }) => {
    if (query.includes('customer(id:')) return 'customer';
    if (query.includes('metaobjectUpsert')) return 'upsert';
    if (query.includes('metafieldsSet')) return 'link';
    return 'other';
  });
  assert.deepEqual(order, ['customer', 'upsert', 'link']);
  assert.match(graphqlCall('customer(id:').query, /firstName lastName/);
  assert.deepEqual(graphqlCall('customer(id:').variables, { id: `gid://shopify/Customer/${CUSTOMER_ID}` });
});

test('takes the ticket letter from the last name, or leaves it out, when the first name is missing', async () => {
  for (const [customerName, expected] of [
    [{ firstName: null, lastName: 'rao' }, 'RIN-78901'],
    [{ firstName: '', lastName: null }, 'IN-78901'],
  ]) {
    shopify.restore();
    shopify = stubShopify({ customerName });

    const response = await post(validForm({ withScreenshot: false }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ticketNumber, expected);
    assert.equal(upsertFieldsByKey().ticket_number, expected);
  }
});

test('leaves the previous screenshot in place when no new one is sent', async () => {
  const response = await post(validForm({ withScreenshot: false }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.screenshotSaved, false);
  assert.equal(shopify.calls.some(({ url }) => url.startsWith('https://uploads.test')), false);
  assert.equal(Object.hasOwn(upsertFieldsByKey(), 'yearly_distance_screenshot'), false);
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

  const response = await post(validForm({ withScreenshot: false }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(body, { ok: false, error: 'Could not save your answers' });
  assert.equal(graphqlCall('metafieldsSet'), undefined);
});

test('writes to the metaobject type and customer metafield named in the environment', async () => {
  process.env.EARLY_ACCESS_METAOBJECT_TYPE = 'quiz_entry';
  process.env.EARLY_ACCESS_CUSTOMER_METAFIELD = 'custom.quiz_entry';

  const response = await post(validForm({ withScreenshot: false }));
  assert.equal(response.status, 200);
  assert.equal(graphqlCall('metaobjectUpsert').variables.handle.type, 'quiz_entry');

  const [link] = graphqlCall('metafieldsSet').variables.metafields;
  assert.equal(link.namespace, 'custom');
  assert.equal(link.key, 'quiz_entry');
});

test('answers 503 without calling Shopify when the metaobject type is not configured', async () => {
  delete process.env.EARLY_ACCESS_METAOBJECT_TYPE;
  const response = await post(validForm());
  assert.equal(response.status, 503);
  assert.equal(shopify.calls.length, 0);
});

test('answers 503 when the customer metafield is not namespace.key', async () => {
  process.env.EARLY_ACCESS_CUSTOMER_METAFIELD = 'submission';
  const response = await post(validForm());
  assert.equal(response.status, 503);
  assert.equal(shopify.calls.length, 0);
});

test('answers 503 when the deployment is missing its secret', async () => {
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  const response = await post(validForm());
  assert.equal(response.status, 503);
  assert.equal(shopify.calls.length, 0);
});

test('accepts every configured storefront origin and the myshopify origin, and echoes it for CORS', async () => {
  for (const origin of [STOREFRONT_ORIGIN, 'https://early-access-test.example', `https://${STORE_DOMAIN}`]) {
    const response = await post(validForm({ withScreenshot: false }), { Origin: origin });
    assert.equal(response.status, 200, `origin ${origin}`);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(response.headers.get('vary'), /Origin/);
  }
});

test('answers the CORS preflight for a storefront origin', async () => {
  const response = await earlyAccess.fetch(
    new Request(API_URL, {
      method: 'OPTIONS',
      headers: { ...FROM_STOREFRONT, 'Access-Control-Request-Method': 'POST' },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), STOREFRONT_ORIGIN);
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(shopify.calls.length, 0);
});

test('refuses another site, and a request with no Origin, without CORS access', async () => {
  for (const headers of [{ Origin: 'https://attacker.example' }, {}]) {
    const response = await post(validForm(), headers);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(shopify.calls.length, 0);
});

test('asks the shopper to sign in when the customer id is missing or malformed', async () => {
  for (const customerId of [null, '', 'abc', '12x', '0', '-5', '1'.repeat(21)]) {
    const form = validForm();
    if (customerId === null) form.delete('customerId');
    else form.set('customerId', customerId);

    const response = await post(form);
    const body = await response.json();
    assert.equal(response.status, 401, `customerId ${customerId}`);
    assert.equal(body.code, 'not_logged_in');
  }
  assert.equal(shopify.calls.length, 0);
});

test('asks the shopper to sign in and writes nothing when the customer does not exist', async () => {
  shopify.restore();
  shopify = stubShopify({ knownCustomer: false });

  const response = await post(validForm());
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.code, 'not_logged_in');
  assert.equal(shopify.calls.some(({ url }) => url.startsWith('https://uploads.test')), false);
  assert.equal(graphqlCall('stagedUploadsCreate'), undefined);
  assert.equal(graphqlCall('metaobjectUpsert'), undefined);
  assert.equal(graphqlCall('metafieldsSet'), undefined);
});

test('returns field errors for invalid answers without calling Shopify', async () => {
  const form = validForm();
  form.delete('goal');
  const response = await post(form);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 'invalid_answers');
  assert.deepEqual(body.fields, { goal: 'required' });
  assert.equal(response.headers.get('access-control-allow-origin'), STOREFRONT_ORIGIN);
  assert.equal(shopify.calls.length, 0);
});

test('answers 502 without leaking Shopify errors when the save fails', async () => {
  shopify.restore();
  globalThis.fetch = async () => new Response('{"errors":"[API] Invalid API key or access token"}', { status: 401 });

  const response = await post(validForm({ withScreenshot: false }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(body, { ok: false, error: 'Could not save your answers' });
});

test('answers 405 with an Allow header for the wrong method', async () => {
  const response = await earlyAccess.fetch(new Request(API_URL, { headers: FROM_STOREFRONT }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
});

test('health answers 200 with every secret missing', async () => {
  clearEnv();
  const response = await health.fetch(new Request('https://metafields-api.test/api/health'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('config test answers 503 and names the missing variables without values', async () => {
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  const response = await configTest.fetch(new Request('https://metafields-api.test/api/test'));
  const text = await response.text();

  assert.equal(response.status, 503);
  assert.match(text, /"name":"SHOPIFY_ADMIN_TOKEN"[^}]*"status":"missing"/);
  assert.equal(text.includes(ADMIN_TOKEN), false);
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
  globalThis.fetch = async () =>
    Response.json({
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
  globalThis.fetch = async () =>
    Response.json({
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
    'SHOPIFY_ADMIN_TOKEN',
    'EARLY_ACCESS_METAOBJECT_TYPE',
    'EARLY_ACCESS_CUSTOMER_METAFIELD',
  ];
  for (const expected of expectedNames) {
    assert.ok(html.includes(expected), `index is missing ${expected}`);
  }
  assert.equal(html.includes(ADMIN_TOKEN), false);
});
