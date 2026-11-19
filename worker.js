import earlyAccess from './api/early-access.js';
import health from './api/health.js';
import test from './api/test.js';
import index from './api/index.js';

const routes = {
  '/api/early-access': earlyAccess,
  '/api/health': health,
  '/api/test': test,
  '/api': index,
  '/': index,
};

export default {
  async fetch(request, env, ctx) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') process.env[key] ??= value;
    }
    const { pathname } = new URL(request.url);
    const handler = routes[pathname.replace(/\/$/, '') || '/'];
    if (!handler) return new Response('Not found', { status: 404 });
    return handler.fetch(request, env, ctx);
  },
};
