/*!
 * Copyright (c) 2026 O. T. Dowling. All rights reserved.
 * Proprietary software: it may not be copied, modified or redistributed without
 * the copyright holder's prior written permission. See the LICENSE file.
 */

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
 *   GROQ_API_KEY  GEMINI_API_KEY  OPENROUTER_API_KEY
 *   COHERE_API_KEY  SAMBANOVA_API_KEY  MISTRAL_API_KEY
 *   PROXY_TOKEN     — if set, callers must send it as the X-Proxy-Token header
 *                     (paste the same value into the app's ⚙ Keys → proxy card)
 *
 * Variables (wrangler.toml [vars]):
 *   ALLOWED_ORIGIN  — the exact site origin(s) allowed to call this Worker,
 *                     comma-separated, e.g. https://mrscruffster.github.io,https://www.ai-council.co.uk
 *
 * Global question counter (no token needed by visitors, no personal data stored):
 *   GET  /count   → { total }      read the running total (browser, allowed origin)
 *   POST /count   → { total }      add one — called once per question asked on the site
 *   PUT  /count   → { total }      OWNER ONLY (X-Proxy-Token): set the total, e.g. {"total":0} to reset
 * The total lives in a Durable Object (class Counter, binding COUNTER), so simultaneous
 * increments from many visitors can never be lost. Per-IP and global rate limits stop one
 * client from inflating it; the IP is used only in memory for that and is never stored.
 */

const PROVIDERS = {
  groq:       { url: "https://api.groq.com/openai/v1/chat/completions",                          secret: "GROQ_API_KEY" },
  gemini:     { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", secret: "GEMINI_API_KEY" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions",                            secret: "OPENROUTER_API_KEY" },
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
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

/* ---------- global question counter ---------- */
const RATE_PER_IP_PER_MIN = 20;      // increments one IP address may add per minute
const RATE_GLOBAL_PER_MIN = 600;     // ...and everyone together (protects the free Durable Objects quota)
const COUNT_CACHE_MS = 15000;        // GETs are answered from memory for a few seconds, so polling stays cheap
let countCache = { at: 0, total: null };

function plain(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

/* One instance holds the single running total; a Durable Object handles one request at a time
   for its storage, so read-add-write can never lose a count to a race. */
export class Counter {
  constructor(state) {
    this.state = state;
    this.hits = new Map();           // ip -> recent increment timestamps (memory only, never stored)
    this.minute = { start: 0, n: 0 };
  }
  async fetch(request) {
    const total = (await this.state.storage.get("total")) || 0;
    if (request.method === "GET") return plain(200, { total });
    if (request.method === "PUT") {
      let n = NaN;
      try { n = Math.floor(Number((await request.json()).total)); } catch (_) { /* falls through to the 400 */ }
      if (!Number.isFinite(n) || n < 0 || n > 1e15) return plain(400, { error: { message: "Send {\"total\": <whole number>}." } });
      await this.state.storage.put("total", n);
      return plain(200, { total: n });
    }
    if (request.method === "POST") {
      const now = Date.now();
      if (now - this.minute.start >= 60000) this.minute = { start: now, n: 0 };
      const ip = request.headers.get("X-Client-IP") || "unknown";
      const recent = (this.hits.get(ip) || []).filter(t => now - t < 60000);
      if (recent.length >= RATE_PER_IP_PER_MIN || this.minute.n >= RATE_GLOBAL_PER_MIN) {
        this.hits.set(ip, recent);
        return plain(429, { total, limited: true });
      }
      recent.push(now);
      this.hits.set(ip, recent);
      this.minute.n++;
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some(t => now - t < 60000)) this.hits.delete(k);
      const next = total + 1;
      await this.state.storage.put("total", next);
      return plain(200, { total: next });
    }
    return plain(405, { error: { message: "GET, POST or PUT only." } });
  }
}

async function handleCount(request, env, cors) {
  if (!env.COUNTER) return json(503, { error: { message: "The counter is not configured on this Worker." } }, cors);
  const stub = env.COUNTER.get(env.COUNTER.idFromName("global"));
  const out = (r, extra) => new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors, ...(extra || {}) } });

  if (request.method === "PUT") {   // owner only: seed or reset the total. Needs the secret token, no browser origin.
    if (!env.PROXY_TOKEN || request.headers.get("X-Proxy-Token") !== env.PROXY_TOKEN) {
      return json(401, { error: { message: "Owner token required." } }, cors);
    }
    const r = await stub.fetch("https://counter/", { method: "PUT", body: await request.text() });
    countCache = { at: 0, total: null };
    return out(r);
  }

  // GET and POST are for the website only: a browser always sends Origin on these cross-origin calls.
  if (!cors["Access-Control-Allow-Origin"]) return json(403, { error: { message: "Origin not allowed." } }, cors);

  if (request.method === "GET") {
    const now = Date.now();
    if (countCache.total !== null && now - countCache.at < COUNT_CACHE_MS) return json(200, { total: countCache.total }, { ...cors, "Cache-Control": "no-store" });
    const r = await stub.fetch("https://counter/", { method: "GET" });
    if (r.ok) { const j = await r.clone().json(); countCache = { at: now, total: j.total }; }   // fresh from storage: authoritative
    return out(r);
  }
  if (request.method === "POST") {
    const r = await stub.fetch("https://counter/", { method: "POST", headers: { "X-Client-IP": request.headers.get("CF-Connecting-IP") || "unknown" } });
    if (r.ok) {
      /* Simultaneous increments finish in any order, so only ever move the cached total FORWARD. */
      const j = await r.clone().json();
      if (countCache.total === null || j.total > countCache.total) countCache = { at: Date.now(), total: j.total };
    }
    return out(r);
  }
  return json(405, { error: { message: "GET or POST only." } }, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
    }

    if (/^\/count\/?$/.test(url.pathname)) return handleCount(request, env, cors);

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
