const STORE_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const METAOBJECT_TYPE_PATTERN = /^[a-z0-9_-]{3,255}$/;
const CUSTOMER_METAFIELD_PATTERN = /^([a-zA-Z0-9_-]{3,255})\.([a-zA-Z0-9_-]{2,64})$/;

function toOrigin(value) {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    const isBareOrigin =
      url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
    return isBareOrigin ? url.origin : null;
  } catch {
    return null;
  }
}

function splitList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function isOriginList(value) {
  const items = splitList(value);
  return items.length > 0 && items.every((item) => toOrigin(item));
}

export const ENV_SPEC = {
  SHOPIFY_STORE_DOMAIN: {
    purpose: 'The store the API serves, as store-name.myshopify.com. Admin API calls go here and app proxy requests from any other shop are refused.',
    required: true,
    isValid: (value) => STORE_DOMAIN_PATTERN.test(value.toLowerCase()),
  },
  SHOPIFY_STOREFRONT_ORIGIN: {
    purpose: 'Public storefront origin the popup runs on, such as https://www.example.com or www.example.com. Comma-separate several. Requests whose browser Origin is any other site are refused; the myshopify.com origin is always allowed.',
    required: true,
    isValid: isOriginList,
  },
  SHOPIFY_API_KEY: {
    purpose: 'Client ID of the Dev Dashboard app, used with the secret to request Admin API tokens.',
    required: true,
  },
  SHOPIFY_API_SECRET: {
    purpose: 'Client secret of the same app. Verifies the app proxy signature on every storefront request and requests Admin API tokens.',
    required: true,
    secret: true,
  },
  EARLY_ACCESS_METAOBJECT_TYPE: {
    purpose: 'Type of the metaobject that holds the quiz answers, such as early_access_submission. One entry per customer.',
    required: true,
    isValid: (value) => METAOBJECT_TYPE_PATTERN.test(value),
  },
  EARLY_ACCESS_CUSTOMER_METAFIELD: {
    purpose: "Customer metafield, as namespace.key, that points to the customer's metaobject entry, such as early_access.submission.",
    required: true,
    isValid: (value) => CUSTOMER_METAFIELD_PATTERN.test(value),
  },
};

export function readEnv(name) {
  const value = process.env[name]?.trim();
  if (!value && ENV_SPEC[name]?.required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readValid(name, hint) {
  const value = readEnv(name);
  if (!ENV_SPEC[name].isValid(value)) throw new Error(`${name} must look like ${hint}`);
  return value;
}

export function readStoreDomain() {
  return readValid('SHOPIFY_STORE_DOMAIN', 'store-name.myshopify.com').toLowerCase();
}

export function readStorefrontOrigins() {
  const configured = splitList(readValid('SHOPIFY_STOREFRONT_ORIGIN', 'https://www.example.com')).map(toOrigin);
  return new Set([...configured, `https://${readStoreDomain()}`]);
}

export function readMetaobjectType() {
  return readValid('EARLY_ACCESS_METAOBJECT_TYPE', 'early_access_submission');
}

export function readCustomerMetafield() {
  const [, namespace, key] = readValid('EARLY_ACCESS_CUSTOMER_METAFIELD', 'early_access.submission').match(
    CUSTOMER_METAFIELD_PATTERN,
  );
  return { namespace, key };
}

function statusOf(name, spec) {
  const value = process.env[name]?.trim();
  if (!value) return 'missing';
  if (spec.isValid && !spec.isValid(value)) return 'invalid';
  return 'set';
}

export function envStatus() {
  return Object.entries(ENV_SPEC).map(([name, spec]) => ({
    name,
    purpose: spec.purpose,
    status: statusOf(name, spec),
  }));
}
