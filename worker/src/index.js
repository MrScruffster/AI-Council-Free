/**
 * AI Council — key-holding proxy (Cloudflare Worker)
 *
 * The browser app posts to  <worker-url>/api/<provider>  with an OpenAI-style
 * chat-completions body. This Worker adds that provider's API key (stored as a
 * Worker secret, never sent to the browser) and forwards the request upstream.
 * It exists mainly for providers that block direct browser calls (SambaNova),
 * and it lets you keep every key out of the browser.
 *
 * Secrets (set with `wrangler secret put NAME`, all optional — set only the
 * providers you use):
 *   GROQ_API_KEY  GEMINI_API_KEY  OPENROUTER_API_KEY  CEREBRAS_API_KEY
 *   COHERE_API_KEY  SAMBANOVA_API_KEY  MISTRAL_API_KEY
 *   PROXY_TOKEN     — if set, callers must send it as the X-Proxy-Token header
 *                     (paste the same value into the app's ⚙ Keys → proxy card)
 *
 * Variables (wrangler.toml [vars]):
 *   ALLOWED_ORIGIN  — the exact site origin(s) allowed to call this Worker,
 *                     comma-separated, e.g. https://mrscruffster.github.io,https://www.ai-council.co.uk
 */

const PROVIDERS = {
  groq:       { url: "https://api.groq.com/openai/v1/chat/completions",                          secret: "GROQ_API_KEY" },
  gemini:     { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", secret: "GEMINI_API_KEY" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions",                            secret: "OPENROUTER_API_KEY" },
  cerebras:   { url: "https://api.cerebras.ai/v1/chat/completions",                              secret: "CEREBRAS_API_KEY" },
  cohere:     { url: "https://api.cohere.ai/compatibility/v1/chat/completions",                  secret: "COHERE_API_KEY" },
  sambanova:  { url: "https://api.sambanova.ai/v1/chat/completions",                             secret: "SAMBANOVA_API_KEY" },
  mistral:    { url: "https://api.mistral.ai/v1/chat/completions",                               secret: "MISTRAL_API_KEY" }
};

const MAX_BODY_BYTES = 256 * 1024;   // chat requests are small; refuse anything huge

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  // Reflect the origin only if it exactly matches one of the allowed ones. No
  // wildcard: an open proxy would let any website spend your keys.
  const ok = origin !== "" && allowed.includes(origin);
  return ok
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Proxy-Token",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }
    : { "Vary": "Origin" };
}

function json(status, obj, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
    }

    const m = url.pathname.match(/^\/api\/([a-z0-9_-]+)\/?$/i);
    if (!m) return json(404, { error: { message: "Not found. Use POST /api/<provider>." } }, cors);
    if (request.method !== "POST") return json(405, { error: { message: "POST only." } }, cors);

    // Browsers always send Origin on cross-origin POSTs; reject anything else.
    if (!cors["Access-Control-Allow-Origin"]) {
      return json(403, { error: { message: "Origin not allowed. Set ALLOWED_ORIGIN to your site's origin." } }, cors);
    }

    if (env.PROXY_TOKEN && request.headers.get("X-Proxy-Token") !== env.PROXY_TOKEN) {
      return json(401, { error: { message: "Bad or missing proxy token." } }, cors);
    }

    const provider = PROVIDERS[m[1].toLowerCase()];
    if (!provider) return json(404, { error: { message: `Unknown provider "${m[1]}".` } }, cors);

    const key = env[provider.secret];
    if (!key) {
      return json(503, { error: { message: `${provider.secret} is not set on the Worker.` } }, cors);
    }

    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > MAX_BODY_BYTES) return json(413, { error: { message: "Request too large." } }, cors);
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return json(413, { error: { message: "Request too large." } }, cors);

    let upstream;
    try {
      upstream = await fetch(provider.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body
      });
    } catch (e) {
      return json(502, { error: { message: "Upstream request failed." } }, cors);
    }

    // Stream the upstream response straight back (works for SSE too), keeping
    // only the headers the browser needs.
    const headers = new Headers(cors);
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    headers.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
