import { envStatus } from '../lib/env.js';
import { json, methodGate, publicPreflight, withPublicCors } from '../lib/http.js';
import { REQUIRED_SCOPES, adminGraphql } from '../lib/shopify.js';

const CONNECTION_QUERY = `
  query ConnectionCheck {
    shop { myshopifyDomain }
    currentAppInstallation { accessScopes { handle } }
  }
`;

async function checkShopify() {
  try {
    const { shop, currentAppInstallation } = await adminGraphql(CONNECTION_QUERY);
    const granted = new Set(currentAppInstallation.accessScopes.map(({ handle }) => handle));
    const missingScopes = REQUIRED_SCOPES.filter((scope) => !granted.has(scope));

    if (missingScopes.length) {
      return {
        ok: false,
        detail: `Connected to ${shop.myshopifyDomain} but the app is missing scopes: ${missingScopes.join(', ')}`,
      };
    }

    return { ok: true, detail: `Connected to ${shop.myshopifyDomain} with ${REQUIRED_SCOPES.join(', ')}` };
  } catch (error) {
    console.error('[test] Shopify check failed', error);
    return { ok: false, detail: error.message };
  }
}

async function handle(request) {
  const preflight = publicPreflight(request);
  if (preflight) return preflight;

  const blocked = methodGate(request, ['GET']);
  if (blocked) return withPublicCors(blocked);

  const environment = envStatus();
  const incomplete = environment.some((entry) => entry.status !== 'set');
  const upstream = incomplete
    ? { ok: false, detail: 'skipped - environment missing or invalid' }
    : await checkShopify();

  const ok = !incomplete && upstream.ok;

  return withPublicCors(
    json(ok ? 200 : 503, { ok, environment, upstream, time: new Date().toISOString() }),
  );
}

export default { fetch: handle };
