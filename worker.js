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

    // Serve static assets for all other requests.
    // Special case: bot-config.js is generated at deploy time by GitHub Actions
    // and contains the bot URL + trigger token. If it hasn't been deployed yet
    // (e.g. Cloudflare secrets aren't configured), serve a default config with
    // the hardcoded fallback values so the dashboard still functions.
    if (url.pathname === '/bot-config.js') {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
      // These fallback values match the FALLBACK_TRIGGER_TOKEN and _BOT_URL
      // constants already present in the public client-side scripts
      // (Analytics/analytics-script.js, Payouts/payouts-script.js), so
      // serving them here adds no additional exposure.
      const defaultConfig = {
        url:   'https://kintsugi-discord-bot.reecestangoe0824.workers.dev',
        token: 'HnoKPfn9ZIYXD79c8PRos4cMphPKNHf5bfCbsjIS',
      };
      return new Response(
        '// Auto-generated fallback (deploy via GitHub Actions to inject real secrets).\n' +
        'window.KINTSUGI_BOT_CONFIG = ' + JSON.stringify(defaultConfig) + ';\n',
        { headers: { 'Content-Type': 'application/javascript' } }
      );
    }

    return env.ASSETS.fetch(request);
  },
};
