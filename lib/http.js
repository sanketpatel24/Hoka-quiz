const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(status, body, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

export function fail(status, message, internal, extra = {}) {
  if (internal) console.error(`[error] ${message}:`, internal);
  return json(status, { ok: false, error: message, ...extra });
}

export function methodGate(request, methods) {
  if (methods.includes(request.method)) return null;
  return json(
    405,
    { ok: false, error: `Method ${request.method} not allowed` },
    { Allow: methods.join(', ') },
  );
}

export function publicPreflight(request) {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

export function withPublicCors(response) {
  for (const [name, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
