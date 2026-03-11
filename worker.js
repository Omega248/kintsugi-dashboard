// =======================================
// Kintsugi Dashboard — Cloudflare Worker (static assets + CORS gateway)
//
// Serves the Kintsugi web dashboard from static assets and adds CORS support
// for /api/* preflight requests so that the dashboard can reach the Discord
// bot worker from a different origin without being blocked by CORS.
//
// The Discord bot is deployed as a SEPARATE Cloudflare Worker named
// "kintsugi-bot" (see discord-bot/wrangler.toml and .github/workflows/deploy-bot.yml).
// All Discord interactions, including the PING → PONG verification handshake,
// are handled entirely by that worker.  The Interactions Endpoint URL in the
// Discord Developer Portal should point to the kintsugi-bot worker URL
// (e.g. https://kintsugi-bot.<subdomain>.workers.dev), NOT to this worker.
//
// All other requests are served from the static assets directory.
// =======================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight for API endpoints
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // This static-assets worker does not implement the bot API routes.
    // Return a CORS-enabled error so the browser receives a clear message
    // rather than a hard CORS block, making misconfiguration easier to debug.
    if (url.pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            'API route not found on this worker. ' +
            'Set the Bot Worker URL in your dashboard settings to your ' +
            'Discord bot worker URL (e.g. https://kintsugi-bot.reecestangoe0824.workers.dev).',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        }
      );
    }

    // Serve static assets for all other requests
    return env.ASSETS.fetch(request);
  },
};
