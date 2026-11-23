export const STORE_DOMAIN = 'early-access-test.myshopify.com';
export const ADMIN_TOKEN = 'shpat_test-token-never-rendered';
export const CUSTOMER_ID = '7712345678901';
export const ENTRY_ID = 'gid://shopify/Metaobject/777';
export const STOREFRONT_ORIGIN = 'https://www.early-access-test.example';
export const API_URL = 'https://metafields-api.test/api/early-access';

const TEST_ENV = {
  SHOPIFY_STORE_DOMAIN: STORE_DOMAIN,
  SHOPIFY_STOREFRONT_ORIGIN: `${STOREFRONT_ORIGIN}, early-access-test.example`,
  SHOPIFY_ADMIN_TOKEN: ADMIN_TOKEN,
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

export function validForm({ withScreenshot = true } = {}) {
  const form = new FormData();
  form.set('customerId', CUSTOMER_ID);
  form.set('yearly_distance_km', '850.5');
  form.append('surfaces', 'road');
  form.append('surfaces', 'trail');
  form.set('goal', 'half-marathon');
  if (withScreenshot) {
    form.set('yearly_distance_screenshot', new File([PNG_BYTES], 'my year.png', { type: 'image/png' }));
  }
  return form;
}

export const CUSTOMER_NAME = { firstName: 'Asha', lastName: 'Rao' };
export const CUSTOMER_TICKET = 'AIN-78901';

export function stubShopify({ knownCustomer = true, customerName = CUSTOMER_NAME } = {}) {
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });

    if (target === 'https://uploads.test/upload') return new Response(null, { status: 204 });

    if (target.endsWith('/graphql.json')) {
      const { query, variables } = JSON.parse(init.body);
      if (query.includes('customer(id:')) {
        return Response.json({
          data: { customer: knownCustomer ? { id: variables.id, ...customerName } : null },
        });
      }
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
