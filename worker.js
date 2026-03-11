// =======================================
// Kintsugi Dashboard — Cloudflare Worker (static assets + CORS gateway)
//
// Adds CORS support for /api/* preflight requests so that the web
// dashboard (hosted on GitHub Pages or Cloudflare Workers) can reach the
// Discord Bot worker from a different origin without being blocked by CORS.
//
// Also handles the Discord Interactions Endpoint verification handshake so
// that Discord's Developer Portal can confirm this URL as a valid bot
// endpoint. The PING → PONG exchange is verified with an Ed25519 signature
// using the DISCORD_PUBLIC_KEY secret.
//
// All other requests are served from the static assets directory.
//
// Required Cloudflare Worker secrets (set via `wrangler secret put` or
// synced automatically by the GitHub Actions deploy workflow):
//   DISCORD_PUBLIC_KEY  — Ed25519 public key from the Discord Developer Portal
//   DISCORD_BOT_TOKEN   — Bot token (used by the Discord bot worker for API calls)
// =======================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400',
};

/** Convert a hex string to a Uint8Array. */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verify the Ed25519 signature Discord attaches to every interaction.
 * Cloudflare Workers expose `crypto.subtle` which supports Ed25519 natively.
 * Returns false if the public key is missing or the signature is invalid.
 */
async function verifyDiscordSignature(rawBody, signature, timestamp, publicKey) {
  if (!publicKey) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody)
    );
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight for API endpoints
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Discord Interactions Endpoint — handle the verification handshake.
    //
    // When you register an Interactions Endpoint URL in the Discord Developer
    // Portal, Discord sends a signed POST with a PING interaction (type 1).
    // We must verify the Ed25519 signature with DISCORD_PUBLIC_KEY and
    // respond with a PONG (type 1) for the URL to be accepted.
    //
    // This check runs before the API-route guard so that Discord's own
    // verification requests are never mistaken for dashboard API calls.
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    if (request.method === 'POST' && signature && timestamp) {
      const rawBody = await request.text();
      const valid = await verifyDiscordSignature(
        rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY
      );
      if (!valid) {
        return new Response('Invalid request signature', { status: 401 });
      }

      let interaction;
      try {
        interaction = JSON.parse(rawBody);
      } catch {
        return new Response('Bad Request', { status: 400 });
      }

      // PING (type 1) — required for Discord Interactions Endpoint verification
      if (interaction.type === 1) {
        return new Response(JSON.stringify({ type: 1 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Other interaction types are handled by the Discord bot worker
      // (deployed from discord-bot/worker.js via .github/workflows/deploy-bot.yml).
      return new Response('Interaction not handled by this worker', { status: 400 });
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
            'Discord bot worker URL (e.g. https://kintsugi.reecestangoe0824.workers.dev).',
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
