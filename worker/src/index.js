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
 *   TAVILY_API_KEY  — web search only (tavily.com: free, no card, 1,000 searches a month, shared by
 *                     everyone who uses THIS deployment — it is not per visitor)
 *   PROXY_TOKEN     — if set, callers must send it as the X-Proxy-Token header
 *                     (paste the same value into the app's ⚙ Keys → proxy card)
 *
 * Two extra routes sit beside the chat providers, behind the same origin + PROXY_TOKEN checks:
 *   POST /api/transcribe  multipart audio → { text }   Groq Whisper, using GROQ_API_KEY (no new secret)
 *   POST /api/websearch   { query } → { results: [{ title, url, content }] }   Tavily, using TAVILY_API_KEY
 *                         { query, trusted: true } searches only the trusted-source list (see "trusted sources"
 *                         below) and adds a "kind" to each result. That is what the Council source check uses.
 *   GET|POST /trusted     OWNER ONLY (X-Proxy-Token): GET reports the merged list's size and last refresh, POST refreshes now
 * Optional KV binding TRUSTED_KV + a weekly cron keep the IFCN and CISA lists fresh; without them only the static lists are used.
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

/* ---------- transcription + web search ----------
   Both spend a shared, limited free quota (Groq's free-tier limits; Tavily's 1,000 searches a month),
   so each gets a per-IP speed limit on top of the origin and PROXY_TOKEN checks. The limiter lives in
   this isolate's memory only: Cloudflare may run several isolates of a Worker, so it is a speed bump
   that stops one browser tab looping, not a hard cap. The providers' own quotas are the real ceiling. */
const TOOL_RATE_PER_IP_PER_MIN = 12;
const toolHits = new Map();          // "bucket|ip" -> recent request timestamps (memory only, never stored)
function toolRateLimited(request, bucket) {
  const now = Date.now();
  const k = bucket + "|" + (request.headers.get("CF-Connecting-IP") || "unknown");
  const recent = (toolHits.get(k) || []).filter(t => now - t < 60000);
  if (recent.length >= TOOL_RATE_PER_IP_PER_MIN) { toolHits.set(k, recent); return true; }
  recent.push(now);
  toolHits.set(k, recent);
  if (toolHits.size > 5000) for (const [key, v] of toolHits) if (!v.some(t => now - t < 60000)) toolHits.delete(key);
  return false;
}

const TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";   // fixed here: the client is not trusted to pick the model
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;             // the app records at most ~60 s (well under 1 MB); Groq's own cap is far higher

/* Forwards a recording to Groq's Whisper endpoint. A FRESH form is built with only the file and our
   own settings, so a client can't smuggle in other fields (a different model, a prompt, a language). */
async function handleTranscribe(request, env, cors) {
  if (!env.GROQ_API_KEY) return json(503, { error: { message: "GROQ_API_KEY is not set on the Worker." } }, cors);
  if (toolRateLimited(request, "transcribe")) return json(429, { error: { message: "Too many voice requests. Wait a minute and try again." } }, cors);
  if (!/^multipart\/form-data/i.test(request.headers.get("Content-Type") || "")) {
    return json(400, { error: { message: "Send the recording as multipart/form-data with a \"file\" field." } }, cors);
  }
  if (Number(request.headers.get("Content-Length") || 0) > MAX_AUDIO_BYTES) return json(413, { error: { message: "Recording too large." } }, cors);

  let form;
  try { form = await request.formData(); } catch (_) { return json(400, { error: { message: "Couldn't read the upload." } }, cors); }
  const file = form.get("file");
  if (!file || typeof file === "string") return json(400, { error: { message: "No audio file in the request." } }, cors);
  if (file.size > MAX_AUDIO_BYTES) return json(413, { error: { message: "Recording too large." } }, cors);

  const out = new FormData();
  out.set("file", file, file.name || "recording.webm");
  out.set("model", TRANSCRIBE_MODEL);
  out.set("response_format", "json");
  out.set("temperature", "0");
  let upstream;
  try {
    // no Content-Type header on purpose: fetch sets it, with the multipart boundary, from the FormData
    upstream = await fetch(TRANSCRIBE_URL, { method: "POST", headers: { "Authorization": "Bearer " + env.GROQ_API_KEY }, body: out });
  } catch (_) {
    return json(502, { error: { message: "Upstream request failed." } }, cors);
  }
  const raw = await upstream.text();
  let j = null;
  try { j = JSON.parse(raw); } catch (_) { /* not JSON: handled below */ }
  if (!upstream.ok) {
    // A 401/403 from Groq means the Worker's own key is bad. Sent on as-is, the app would read it as "wrong proxy token".
    const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
    const msg = (j && j.error && j.error.message) || `Transcription failed (HTTP ${upstream.status}).`;
    return json(status, { error: { message: status === 502 && upstream.status !== 502 ? "Groq rejected the Worker's GROQ_API_KEY. " + msg : msg } }, cors);
  }
  return json(200, { text: String((j && j.text) || "") }, { ...cors, "Cache-Control": "no-store" });
}

const TAVILY_URL = "https://api.tavily.com/search";
const MAX_QUERY_CHARS = 400;

/* Forwards a search to Tavily and returns only what the app needs. Tavily's raw response (scores,
   request ids, timings, an optional "answer") is deliberately not passed through. */
async function handleWebSearch(request, env, cors) {
  if (!env.TAVILY_API_KEY) return json(503, { error: { message: "TAVILY_API_KEY is not set on the Worker." } }, cors);
  if (toolRateLimited(request, "websearch")) return json(429, { error: { message: "Too many searches. Wait a minute and try again." } }, cors);
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return json(413, { error: { message: "Request too large." } }, cors);
  let query = "", wantTrusted = false;
  try { const b = await request.json(); query = String(b.query || "").trim(); wantTrusted = b.trusted === true; } catch (_) { /* falls through to the 400 */ }
  if (!query || query.length > MAX_QUERY_CHARS) return json(400, { error: { message: `Send {"query": "<1-${MAX_QUERY_CHARS} characters>"}.` } }, cors);

  /* {"trusted": true} restricts the search to the trusted-source list above (the Council source check); each result then
     also carries its "kind". A plain search stays open to the whole web. */
  const trusted = wantTrusted ? await loadTrusted(env) : null;
  const payload = { query, search_depth: "basic", max_results: 5 };
  if (trusted) payload.include_domains = trusted.domains;
  let upstream;
  try {
    upstream = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.TAVILY_API_KEY },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    return json(502, { error: { message: "Upstream request failed." } }, cors);
  }
  let j = null;
  try { j = await upstream.json(); } catch (_) { /* not JSON: handled below */ }
  if (!upstream.ok) {
    // Per Tavily's API docs, 429 is a rate limit and 432/433 mean the plan's monthly allowance is used up.
    // All three become a 429 here so the app can say "quota used up" instead of "something broke".
    if ([429, 432, 433].includes(upstream.status)) return json(429, { error: { message: "Web search quota used up (the free plan allows 1,000 searches a month, shared by everyone using this Worker)." } }, cors);
    if (upstream.status === 401 || upstream.status === 403) return json(502, { error: { message: "Tavily rejected the Worker's TAVILY_API_KEY." } }, cors);
    const detail = (j && j.detail && j.detail.error) || (j && j.error && j.error.message) || "";
    return json(502, { error: { message: `Search failed (HTTP ${upstream.status}). ${detail}`.trim() } }, cors);
  }
  const results = (Array.isArray(j && j.results) ? j.results : []).slice(0, 5).map(r => {
    const item = {
      title: String((r && r.title) || "").slice(0, 200),
      url: String((r && r.url) || "").slice(0, 500),
      content: String((r && r.content) || "").slice(0, 800)   // keeps five results well inside a model's context
    };
    if (trusted) item.kind = trustedKindOf(item.url, trusted) || "trusted";
    return item;
  });
  return json(200, { results }, { ...cors, "Cache-Control": "no-store" });
}

/* ---------- trusted sources (for the Council "source check") ----------
   When Council models disagree, the app searches ONLY these domains (Tavily's include_domains) and shows what
   the sources say. Two kinds of list feed it:
     1. the static groups below: small, fixed, human-curated, edited here and redeployed;
     2. two lists refreshed weekly by the cron job into KV: IFCN fact-checkers and a slice of CISA's .gov registry.
   Hosts are listed with and without "www." where a site answers on both. I have not verified whether Tavily's
   include_domains also matches subdomains, so nothing here relies on it.

   These lists are NOT interchangeable kinds of trust, and the app labels each source with its kind:
     general / legislative / historical / scientific / us-federal : a real document published by that institution
     fact-check (IFCN)                                            : an organisation whose fact-checking practice has been
                                                                    audited. Still not "every page there is true".
   None of them makes a page correct; they narrow the search to places where a wrong page is less likely. */

/* General: official statistics, health, science and intergovernmental bodies. */
const GENERAL_TRUSTED_DOMAINS = [
  "cdc.gov", "www.cdc.gov", "nih.gov", "www.nih.gov", "fda.gov", "www.fda.gov",
  "nasa.gov", "www.nasa.gov", "noaa.gov", "www.noaa.gov", "nist.gov", "www.nist.gov",
  "census.gov", "www.census.gov", "bls.gov", "www.bls.gov", "epa.gov", "www.epa.gov", "usgs.gov", "www.usgs.gov",
  "gov.uk", "www.gov.uk", "ons.gov.uk", "www.ons.gov.uk", "nhs.uk", "www.nhs.uk",
  "who.int", "www.who.int", "un.org", "www.un.org", "europa.eu", "ec.europa.eu",
  "oecd.org", "www.oecd.org", "worldbank.org", "www.worldbank.org", "imf.org", "www.imf.org"
];
/* Legislative: primary-source law text (the statute or bill itself), not reporting about law. */
const LEGISLATIVE_TRUSTED_DOMAINS = [
  "congress.gov", "www.congress.gov",                   // Library of Congress: US bills and statutes
  "legislation.gov.uk", "www.legislation.gov.uk",       // UK statute text; Crown copyright, Open Government Licence
  "govinfo.gov", "www.govinfo.gov",                     // proposed addition: US Government Publishing Office (US Code, Federal Register, Congressional Record)
  "eur-lex.europa.eu"                                   // proposed addition: the EU's official law portal
];
/* Historical: digitised primary records, from the same institution as congress.gov above. */
const HISTORICAL_TRUSTED_DOMAINS = [
  "loc.gov", "www.loc.gov", "chroniclingamerica.loc.gov",   // Library of Congress archives and digitised historical newspapers
  "archives.gov", "www.archives.gov"                        // proposed addition: US National Archives
];
/* Scientific: sources that carry a real vetting signal, not just "a document exists". */
const SCIENTIFIC_TRUSTED_DOMAINS = [
  "pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov",   // NIH/NLM. PubMed only indexes journals that pass an editorial selection process
  "doaj.org"                                            // Directory of Open Access Journals: a curated whitelist built to screen out predatory journals
];
/* Deliberately NOT here: Crossref. It is a metadata-only API (DOIs, titles, reference lists) with no browsable
   content of its own, so a search restricted to it would return nothing readable, and a DOI merely resolves to
   whichever publisher hosts the paper, which is a different question from whether that publisher is reliable. */
const STATIC_TRUSTED_GROUPS = [
  ["general", GENERAL_TRUSTED_DOMAINS], ["legislative", LEGISLATIVE_TRUSTED_DOMAINS],
  ["historical", HISTORICAL_TRUSTED_DOMAINS], ["scientific", SCIENTIFIC_TRUSTED_DOMAINS]
];

const TRUSTED_CAP = 300;                    // Tavily's limit on include_domains
const TRUSTED_CACHE_MS = 10 * 60 * 1000;    // KV is read at most once per 10 minutes per Worker instance
let trustedCache = { at: 0, val: null };

const CISA_CSV_URL = "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-federal.csv";   // CISA's registry of federal .gov domains
/* IFCN's public signatory page has no download. This is the JSON endpoint that page itself loads its list from
   (found by reading the page's script), so it is undocumented and could change; a failed refresh keeps the last good list. */
const IFCN_URL = "https://ifcn-cop-prod-server-8q9x7.ondigitalocean.app/api/organization/signatories";

/* The registry has ~1,300 federal domains, four times Tavily's cap, and is not a quality ranking (it includes
   campaign-style and archived sites). So only agencies whose job is science, health, statistics, law or records are
   considered, and at most CISA_PER_AGENCY domains are kept per agency, shortest name first (an agency's main site,
   e.g. cdc.gov or noaa.gov, is nearly always its shortest). This is a heuristic; the static lists above name the
   important ones explicitly. */
const CISA_AGENCY_RE = /(Centers for Disease|Institutes? of Health|Food and Drug|Geological Survey|Oceanic and Atmospheric|Bureau of the Census|Bureau of Labor Statistics|Standards and Technology|Aeronautics and Space|Environmental Protection|Energy Information Administration|National Science Foundation|Bureau of Economic Analysis|Bureau of Justice Statistics|Bureau of Transportation Statistics|Library of Congress|Archives and Records|Government Publishing|Congressional Budget|Government Accountability|Patent and Trademark|Fish and Wildlife|National Park Service|Nuclear Regulatory|Agency for Healthcare Research)/i;
const CISA_PER_AGENCY = 2;

/* Small CSV reader (handles quoted fields with commas); the registry has ~70 such rows. */
function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function selectCisaDomains(csvText) {
  const rows = csvText.replace(/\r/g, "").trim().split("\n").slice(1).map(parseCsvLine);   // columns: domain, type, organisation, suborganisation, ...
  const groups = new Map();
  for (const r of rows) {
    if (r.length < 4 || !/^Federal - (Executive|Legislative)$/.test(r[1]) || !CISA_AGENCY_RE.test(r[2] + " | " + r[3])) continue;
    const key = r[2] + "|" + r[3];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r[0].trim().toLowerCase());
  }
  const picked = [];
  for (const list of groups.values()) picked.push(...list.filter(d => /^[a-z0-9.-]+\.gov$/.test(d)).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).slice(0, CISA_PER_AGENCY));
  return { domains: picked, registryRows: rows.length };
}
function hostOf(website) {
  try {
    let w = String(website || "").trim();
    if (!w) return null;
    if (!/^https?:\/\//i.test(w)) w = "https://" + w;
    return new URL(w).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch (_) { return null; }
}
function selectIfcnDomains(data) {
  const orgs = Array.isArray(data && data.organizations) ? data.organizations : [];
  const hosts = orgs
    .filter(o => o && o.signatory_status === "Verified Signatory" && !o.expired)   // not "In Renewal" or "Expired"
    .map(o => hostOf(o.organization_owner && o.organization_owner.website))
    .filter(h => h && h.includes("."));
  return { domains: [...new Set(hosts)], listed: orgs.length };
}

/* Cron job (and the owner's POST /trusted): re-downloads both lists into KV. Each list is refreshed on its own, and a
   list is only replaced if the new one looks sane (a minimum size), so a changed file format or an outage can never
   blank a working list. The previous list simply stays until the next run. */
async function refreshTrusted(env) {
  if (!env.TRUSTED_KV) return { error: "TRUSTED_KV is not bound on this Worker, so only the static lists are used." };
  const meta = (await env.TRUSTED_KV.get("meta", "json")) || {};
  const at = new Date().toISOString();
  for (const [name, url, select, minKept] of [["cisa", CISA_CSV_URL, selectCisaDomains, 10], ["ifcn", IFCN_URL, selectIfcnDomains, 20]]) {
    try {
      const res = await fetch(url, { headers: { "Accept": name === "ifcn" ? "application/json" : "text/csv" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const sel = select(name === "ifcn" ? await res.json() : await res.text());
      if (sel.domains.length < minKept) throw new Error(`only ${sel.domains.length} domains selected (expected at least ${minKept}); the source's format may have changed, so the old list was kept`);
      await env.TRUSTED_KV.put(name, JSON.stringify(sel.domains));
      meta[name] = { at, kept: sel.domains.length, sourceRows: sel.registryRows || sel.listed };
      delete meta[name + "Error"];
    } catch (e) {
      meta[name + "Error"] = { at, message: String(e.message || e).slice(0, 300) };
      console.warn(`Trusted-source refresh failed for ${name}: ${meta[name + "Error"].message}`);
    }
  }
  await env.TRUSTED_KV.put("meta", JSON.stringify(meta));
  trustedCache = { at: 0, val: null };
  return meta;
}

/* Merges everything into one list, in priority order: static groups, then IFCN, then CISA. Over Tavily's cap, the
   tail is dropped and a warning is logged with what was lost, never silently. */
async function loadTrusted(env) {
  const now = Date.now();
  if (trustedCache.val && now - trustedCache.at < TRUSTED_CACHE_MS) return trustedCache.val;
  let ifcn = [], cisa = [], meta = null;
  if (env.TRUSTED_KV) {
    try {
      [ifcn, cisa, meta] = await Promise.all([env.TRUSTED_KV.get("ifcn", "json"), env.TRUSTED_KV.get("cisa", "json"), env.TRUSTED_KV.get("meta", "json")]);
    } catch (e) { console.warn("Trusted-source KV read failed: " + e.message); }
  }
  const kinds = new Map(), order = [];
  const add = (list, kind) => {
    for (const raw of Array.isArray(list) ? list : []) {
      const d = String(raw).trim().toLowerCase();
      if (d && !kinds.has(d)) { kinds.set(d, kind); order.push(d); }
    }
  };
  for (const [kind, list] of STATIC_TRUSTED_GROUPS) add(list, kind);
  add(ifcn, "fact-check");
  add(cisa, "us-federal");
  const counts = {};
  for (const k of kinds.values()) counts[k] = (counts[k] || 0) + 1;
  let domains = order;
  const truncated = order.length > TRUSTED_CAP;
  if (truncated) {
    domains = order.slice(0, TRUSTED_CAP);
    const lost = {};
    for (const d of order.slice(TRUSTED_CAP)) lost[kinds.get(d)] = (lost[kinds.get(d)] || 0) + 1;
    console.warn(`Trusted domains: ${order.length} is over Tavily's ${TRUSTED_CAP} limit; dropped the last ${order.length - TRUSTED_CAP} (${JSON.stringify(lost)}). Shorten a static list or lower CISA_PER_AGENCY.`);
  }
  const val = { domains, kinds, counts, total: order.length, used: domains.length, truncated, meta };
  trustedCache = { at: now, val };
  return val;
}
/* Which kind of trusted source a result URL is on (its host, its www/bare twin, or a parent domain), or "" if none. */
function trustedKindOf(url, trusted) {
  let h;
  try { h = new URL(url).hostname.toLowerCase(); } catch (_) { return ""; }
  while (h.includes(".")) {
    const twin = h.startsWith("www.") ? h.slice(4) : "www." + h;
    if (trusted.kinds.has(h)) return trusted.kinds.get(h);
    if (trusted.kinds.has(twin)) return trusted.kinds.get(twin);
    h = h.slice(h.indexOf(".") + 1);
  }
  return "";
}

/* Owner only (X-Proxy-Token): GET /trusted reports the merged list's size and last refresh; POST /trusted refreshes now. */
async function handleTrusted(request, env, cors) {
  if (!env.PROXY_TOKEN || request.headers.get("X-Proxy-Token") !== env.PROXY_TOKEN) return json(401, { error: { message: "Owner token required." } }, cors);
  if (request.method === "POST") {
    const meta = await refreshTrusted(env);
    if (meta.error) return json(503, { error: { message: meta.error } }, cors);
  } else if (request.method !== "GET") return json(405, { error: { message: "GET or POST only." } }, cors);
  const t = await loadTrusted(env);
  return json(200, { total: t.total, used: t.used, cap: TRUSTED_CAP, truncated: t.truncated, counts: t.counts, kv: !!env.TRUSTED_KV, meta: t.meta }, { ...cors, "Cache-Control": "no-store" });
}

/* ---------- global question counter ---------- */
const RATE_PER_IP_PER_MIN = 20;    // increments one IP address may add per minute
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
  /* Weekly cron (see wrangler.toml): refreshes the IFCN and CISA lists in KV. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshTrusted(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
    }

    if (/^\/count\/?$/.test(url.pathname)) return handleCount(request, env, cors);
    if (/^\/trusted\/?$/.test(url.pathname)) return handleTrusted(request, env, cors);

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

    // The two non-chat routes share the origin and token checks above.
    if (m[1].toLowerCase() === "transcribe") return handleTranscribe(request, env, cors);
    if (m[1].toLowerCase() === "websearch") return handleWebSearch(request, env, cors);

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
