import { readEnv, readStoreDomain } from './env.js';

export const API_VERSION = '2026-10';
export const REQUIRED_SCOPES = ['write_customers', 'write_files', 'write_metaobjects'];

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cachedToken = null;

export class ShopifyUserError extends Error {
  constructor(operation, userErrors) {
    super(`${operation} returned user errors`);
    this.userErrors = userErrors;
  }
}

async function requestAccessToken(domain) {
  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: readEnv('SHOPIFY_API_KEY'),
      client_secret: readEnv('SHOPIFY_API_SECRET'),
    }),
  });

  if (!response.ok) {
    console.error('[shopify] token request failed', response.status, await response.text());
    throw new Error(`Shopify token request failed with status ${response.status}`);
  }

  const { access_token: value, expires_in: expiresInSeconds } = await response.json();
  return { domain, value, expiresAt: Date.now() + expiresInSeconds * 1000 };
}

async function getAccessToken(domain) {
  const isFresh =
    cachedToken?.domain === domain &&
    cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now();

  if (!isFresh) cachedToken = await requestAccessToken(domain);
  return cachedToken.value;
}

export function clearTokenCache() {
  cachedToken = null;
}

export async function adminGraphql(query, variables = {}) {
  const domain = readStoreDomain();
  const token = await getAccessToken(domain);

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
