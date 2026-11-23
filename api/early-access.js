import { MAX_REQUEST_BYTES, parseSubmission, readCustomerId } from '../lib/early-access.js';
import { findCustomer, saveSubmission } from '../lib/early-access-store.js';
import { envStatus, readCustomerMetafield, readMetaobjectType, readStorefrontOrigins } from '../lib/env.js';
import { fail, json, methodGate, withStorefrontCors } from '../lib/http.js';

const SIGN_IN_MESSAGE = 'Sign in to join Early Access';

function readConfig() {
  const problems = envStatus().filter(({ status }) => status !== 'set');
  if (problems.length) {
    throw new Error(problems.map(({ name, status }) => `${name} ${status}`).join(', '));
  }

  return {
    storefrontOrigins: readStorefrontOrigins(),
    target: { metaobjectType: readMetaobjectType(), customerMetafield: readCustomerMetafield() },
  };
}

async function submit(request, target) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return fail(413, 'Upload is too large', null, { code: 'too_large' });

  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    return fail(400, 'Send the answers as form data', error.message);
  }

  const customerId = readCustomerId(formData);
  if (!customerId) return fail(401, SIGN_IN_MESSAGE, null, { code: 'not_logged_in' });

  let submission;
  try {
    submission = await parseSubmission(formData);
  } catch (error) {
    return fail(400, 'Could not read the answers', error);
  }

  const { answers, screenshot, errors } = submission;
  if (errors) return fail(400, 'Some answers need attention', null, { code: 'invalid_answers', fields: errors });

  try {
    const customer = await findCustomer(customerId);
    if (!customer) {
      return fail(401, SIGN_IN_MESSAGE, `unknown customer ${customerId}`, { code: 'not_logged_in' });
    }
    const result = await saveSubmission({ customerId, ticketNumber: customer.ticketNumber, answers, screenshot, target });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return fail(502, 'Could not save your answers', error.userErrors ?? error);
  }
}

async function handle(request) {
  const blocked = methodGate(request, ['POST', 'OPTIONS']);
  if (blocked) return blocked;

  let config;
  try {
    config = readConfig();
  } catch (error) {
    return fail(503, 'Service not configured', error.message);
  }

  const origin = request.headers.get('origin');
  if (!origin || !config.storefrontOrigins.has(origin)) {
    return fail(403, 'Request must come from the store', `unexpected origin ${origin ?? '(none)'}`);
  }

  const response =
    request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await submit(request, config.target);
  return withStorefrontCors(response, origin);
}

export default { fetch: handle };
