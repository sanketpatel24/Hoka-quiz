import { readEnv, readStoreDomain } from './env.js';

export const API_VERSION = '2026-10';
export const REQUIRED_SCOPES = ['write_customers', 'write_files', 'write_metaobjects'];

export class ShopifyUserError extends Error {
  constructor(operation, userErrors) {
    super(`${operation} returned user errors`);
    this.userErrors = userErrors;
  }
}

export async function adminGraphql(query, variables = {}) {
  const domain = readStoreDomain();
  const token = readEnv('SHOPIFY_ADMIN_TOKEN');

  const response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    console.error('[shopify] GraphQL request failed', response.status, await response.text());
    throw new Error(`Shopify GraphQL request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    console.error('[shopify] GraphQL errors', JSON.stringify(payload.errors));
    throw new Error('Shopify GraphQL request returned errors');
  }

  return payload.data;
}

export function assertNoUserErrors(operation, userErrors) {
  if (userErrors?.length) throw new ShopifyUserError(operation, userErrors);
}
