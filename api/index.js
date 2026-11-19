import { ENV_SPEC } from '../lib/env.js';
import { methodGate } from '../lib/http.js';
import { SERVICE_NAME } from '../lib/service.js';
import { REQUIRED_SCOPES } from '../lib/shopify.js';

const ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/early-access',
    auth: 'SHOPIFY_API_SECRET',
    description:
      "Called when the shopper presses Continue on question 4. Creates or updates the logged-in customer's entry of the EARLY_ACCESS_METAOBJECT_TYPE metaobject with all four answers and the optional run screenshot, then links it from the EARLY_ACCESS_CUSTOMER_METAFIELD customer metafield. Only reachable through the store app proxy at /apps/early-access, which signs the request and names the customer.",
  },
  {
    method: 'GET',
    path: '/api/test',
    auth: 'public',
    link: true,
    description: `Configuration check: reports each environment variable as set, missing or invalid, then confirms the Admin API connection and the ${REQUIRED_SCOPES.join(', ')} scopes.`,
  },
  {
    method: 'GET',
    path: '/api/health',
    auth: 'public',
    link: true,
    description: 'Liveness only. Reads no environment and makes no Shopify call.',
  },
];

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escape = (value) => String(value).replace(/[&<>"]/g, (character) => HTML_ESCAPES[character]);

function endpointRow({ method, path, auth, description, link }) {
  const label = `${method} ${path}`;
  const name = link ? `<a href="${escape(path)}">${escape(label)}</a>` : escape(label);
  const credential = auth === 'public' ? '<span class="public">public</span>' : `<code>${escape(auth)}</code>`;

  return `<tr>
    <td class="endpoint">${name}</td>
    <td class="auth">${credential}</td>
    <td class="description">${escape(description)}</td>
  </tr>`;
}

function envRow([name, spec]) {
  return `<tr>
    <td class="endpoint"><code>${escape(name)}</code></td>
    <td class="description">${escape(spec.purpose)}</td>
  </tr>`;
}

function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>${escape(SERVICE_NAME)}</title>
<style>
  :root { color-scheme: dark; --bg: #0d0d0d; --fg: #f5f5f5; --muted: #a1a1a1; --line: #262626; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 4rem 1.5rem; background: var(--bg); color: var(--fg);
         font: 16px/1.6 ui-sans-serif, -apple-system, system-ui, sans-serif; }
  main { max-width: 56rem; margin: 0 auto; }
  h1 { font-size: 1.15rem; margin: 0 0 .5rem; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       color: var(--muted); font-weight: 600; margin: 3rem 0 .75rem; }
  .lede { color: var(--muted); margin: 0 0 2.5rem; max-width: 42rem; }
  .note { color: var(--muted); margin: 1rem 0 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .7rem 1rem .7rem 0; vertical-align: top; border-top: 1px solid var(--line); }
  tr:first-child td { border-top: 0; }
  .endpoint { white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              font-size: .875rem; width: 1%; }
  .auth { width: 1%; white-space: nowrap; }
  .description { color: var(--muted); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; color: var(--fg); }
  .public { color: var(--muted); font-size: .8125rem; }
  a { color: var(--fg); }
  @media (max-width: 40rem) {
    body { padding: 2.5rem 1rem; }
    td { display: block; border-top: 0; padding: .15rem 0; }
    tr { display: block; padding: .7rem 0; border-top: 1px solid var(--line); }
    .endpoint, .auth { width: auto; white-space: normal; }
  }
</style>
</head>
<body>
<main>
  <h1>${escape(SERVICE_NAME)}</h1>
  <p class="lede">Service is running. There is no UI here. The storefront Early Access popup posts to the store app proxy, which forwards signed requests to the endpoint below.</p>

  <h2>Endpoints</h2>
  <table>${ENDPOINTS.map(endpointRow).join('')}</table>

  <h2>Environment</h2>
  <table>${Object.entries(ENV_SPEC).map(envRow).join('')}</table>
  <p class="note">Names only. Check whether this deployment has them set at <a href="/api/test">/api/test</a>.</p>
</main>
</body>
</html>`;
}

function handle(request) {
  const blocked = methodGate(request, ['GET', 'HEAD']);
  if (blocked) return blocked;

  return new Response(renderPage(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export default { fetch: handle };
