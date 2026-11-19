import { signProxyParams } from '../lib/app-proxy.js';

export const STORE_DOMAIN = 'early-access-test.myshopify.com';
export const API_SECRET = 'test-secret-value-never-rendered';
export const API_KEY = 'test-client-id';
export const CUSTOMER_ID = '7712345678901';
export const ENTRY_ID = 'gid://shopify/Metaobject/777';
export const STOREFRONT_ORIGIN = 'https://www.early-access-test.example';

const TEST_ENV = {
  SHOPIFY_STORE_DOMAIN: STORE_DOMAIN,
  SHOPIFY_STOREFRONT_ORIGIN: `${STOREFRONT_ORIGIN}, early-access-test.example`,
  SHOPIFY_API_KEY: API_KEY,
  SHOPIFY_API_SECRET: API_SECRET,
  EARLY_ACCESS_METAOBJECT_TYPE: 'early_access_submission',
  EARLY_ACCESS_CUSTOMER_METAFIELD: 'early_access.submission',
};

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

export function setEnv() {
  Object.assign(process.env, TEST_ENV);
}

export function clearEnv() {
  for (const name of Object.keys(TEST_ENV)) delete process.env[name];
}

export function proxyUrl({
  customerId = CUSTOMER_ID,
  shop = STORE_DOMAIN,
  timestamp = Math.floor(Date.now() / 1000),
  secret = API_SECRET,
} = {}) {
  const params = new URLSearchParams({
    shop,
    logged_in_customer_id: customerId,
    path_prefix: '/apps/early-access',
    timestamp: String(timestamp),
  });
  params.set('signature', signProxyParams(params, secret));
  return `https://metafields-api.test/api/early-access?${params}`;
}

export function validForm({ withScreenshot = true } = {}) {
  const form = new FormData();
  form.set('weekly_distance', '10-25-km');
  form.append('surfaces', 'road');
  form.append('surfaces', 'trail');
  form.set('goal', 'half-marathon');
  form.set('shoe_fit', 'mens');
  form.set('shoe_size', '9');
  if (withScreenshot) {
    form.set('run_screenshot', new File([PNG_BYTES], 'my run.png', { type: 'image/png' }));
  }
  return form;
}

export function stubShopify() {
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });

    if (target.endsWith('/admin/oauth/access_token')) {
      return Response.json({ access_token: 'shpat_test', expires_in: 86399, scope: 'write_customers,write_files' });
    }

    if (target === 'https://uploads.test/upload') return new Response(null, { status: 204 });

    if (target.endsWith('/graphql.json')) {
      const { query } = JSON.parse(init.body);
      if (query.includes('stagedUploadsCreate')) {
        return Response.json({
          data: {
            stagedUploadsCreate: {
              stagedTargets: [
                {
                  url: 'https://uploads.test/upload',
                  resourceUrl: 'https://uploads.test/resource/run.png',
                  parameters: [{ name: 'key', value: 'tmp/run.png' }],
                },
              ],
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('fileCreate')) {
        return Response.json({
          data: { fileCreate: { files: [{ id: 'gid://shopify/MediaImage/555' }], userErrors: [] } },
        });
      }
      if (query.includes('metaobjectUpsert')) {
        return Response.json({
          data: {
            metaobjectUpsert: {
              metaobject: { id: ENTRY_ID, handle: `customer-${CUSTOMER_ID}` },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('metafieldsSet')) {
        return Response.json({ data: { metafieldsSet: { metafields: [], userErrors: [] } } });
      }
    }

    return new Response('unexpected request', { status: 500 });
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
    graphqlBodies: () =>
      calls.filter(({ url }) => url.endsWith('/graphql.json')).map(({ init }) => JSON.parse(init.body)),
  };
}
