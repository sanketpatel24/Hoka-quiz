import { json, methodGate, publicPreflight, withPublicCors } from '../lib/http.js';
import { SERVICE_NAME } from '../lib/service.js';

function handle(request) {
  const preflight = publicPreflight(request);
  if (preflight) return preflight;

  const blocked = methodGate(request, ['GET']);
  if (blocked) return withPublicCors(blocked);

  return withPublicCors(json(200, { ok: true, service: SERVICE_NAME, time: new Date().toISOString() }));
}

export default { fetch: handle };
