import { verifyProxyRequest } from '../lib/app-proxy.js';
import { MAX_REQUEST_BYTES, parseSubmission } from '../lib/early-access.js';
import { saveSubmission } from '../lib/early-access-store.js';
import {
  readCustomerMetafield,
  readEnv,
  readMetaobjectType,
  readStoreDomain,
  readStorefrontOrigins,
} from '../lib/env.js';
import { fail, json, methodGate } from '../lib/http.js';

function readConfig() {
  return {
    secret: readEnv('SHOPIFY_API_SECRET'),
    storeDomain: readStoreDomain(),
    storefrontOrigins: readStorefrontOrigins(),
    target: { metaobjectType: readMetaobjectType(), customerMetafield: readCustomerMetafield() },
  };
}

function isForeignOrigin(request, allowedOrigins) {
  const origin = request.headers.get('origin');
  return Boolean(origin) && !allowedOrigins.has(origin);
}

async function handle(request) {
  const blocked = methodGate(request, ['POST']);
  if (blocked) return blocked;

  let config;
  try {
    config = readConfig();
  } catch (error) {
    return fail(503, 'Service not configured', error.message);
  }

  const proxy = verifyProxyRequest(request.url, config.secret);
  if (!proxy.valid) return fail(401, 'Request must come through the store', proxy.reason);
  if (proxy.shop !== config.storeDomain) return fail(401, 'Request must come through the store', `unexpected shop ${proxy.shop}`);
  if (isForeignOrigin(request, config.storefrontOrigins)) {
    return fail(403, 'Request must come from the store', `unexpected origin ${request.headers.get('origin')}`);
  }
  if (!proxy.customerId) return fail(401, 'Sign in to join Early Access', null, { code: 'not_logged_in' });

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return fail(413, 'Upload is too large', null, { code: 'too_large' });

  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    return fail(400, 'Send the answers as form data', error.message);
  }

  let submission;
  try {
    submission = await parseSubmission(formData);
  } catch (error) {
    return fail(400, 'Could not read the answers', error);
  }

  const { answers, screenshot, errors } = submission;
  if (errors) return fail(400, 'Some answers need attention', null, { code: 'invalid_answers', fields: errors });

  try {
    const result = await saveSubmission({ customerId: proxy.customerId, answers, screenshot, target: config.target });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return fail(502, 'Could not save your answers', error.userErrors ?? error);
  }
}

export default { fetch: handle };
