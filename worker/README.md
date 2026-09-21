# AI Council proxy (Cloudflare Worker)

Optional, and for the site owner only. It holds your own provider API keys server-side and
forwards the app's requests, so you can use the site without pasting keys into the browser.
Visitors to the public site don't use it: they paste their own free keys (see the welcome
pop-up). Always set a `PROXY_TOKEN`, otherwise anyone who can send requests from an allowed
origin could spend your keys.

## Deploy (about 5 minutes, free Cloudflare account is enough)

```bash
cd worker
npx wrangler login
npx wrangler deploy                      # prints https://ai-council-proxy.<you>.workers.dev

# add only the providers you use (each prompts for the key):
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY   # etc.

# required in practice: a shared token so only you can use the Worker
npx wrangler secret put PROXY_TOKEN
```

Secret names: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
`COHERE_API_KEY`, `SAMBANOVA_API_KEY`, `MISTRAL_API_KEY`.

- **Voice input reuses `GROQ_API_KEY`.** There is no new secret for it.
- **Web search has no Worker secret at all: everyone uses their own free Tavily key.** A visitor pastes it in
  **⚙ Keys → Tavily web search key** (free at [tavily.com](https://tavily.com), no credit card, 1,000 searches a month, their own
  allowance). The browser calls Tavily directly, so there is no shared key and no shared quota for anyone to use up. This was
  changed from an earlier design that put one shared key on the Worker.

## What the Worker offers besides chat

| Route | What it does | Uses |
|---|---|---|
| `POST /api/<provider>` | forwards a chat request to that provider | that provider's key |
| `POST /api/transcribe` | 🎙️ voice input: forwards a recording to Groq's Whisper (`whisper-large-v3-turbo`, fixed on the server) and returns `{ "text": "…" }` | `GROQ_API_KEY` |
| `POST /api/upload` | routes validated images to the existing vision-capable provider, prompts to an existing chat provider, and documents to an existing extraction-capable provider | existing `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` or `MISTRAL_API_KEY` |
| `GET /trusted-domains` | the website (allowed origin, no token): the merged trusted list as `[host, kind]` pairs, so a visitor's own-key searches get the IFCN/CISA parts too. Domain names only | optional KV `TRUSTED_KV` |
| `GET` / `POST /trusted` | **you only** (`X-Proxy-Token`): report the trusted list's size and last refresh / refresh it now | optional KV `TRUSTED_KV` |

`/api/*` and `/trusted` sit behind the origin check and `PROXY_TOKEN`. `/api/transcribe` also has a per-IP limit of
12 requests a minute. That limit is held in each Worker instance's memory, so it stops one browser tab looping
but is not a hard cap; Groq's own quota is the real ceiling.

Uploads are limited to 10 MiB, require matching MIME types and file signatures,
and are limited to ten requests per source IP per minute. No additional upload
credentials are required: the route reuses the existing provider secrets. PDF
and DOCX extraction depends on the selected provider accepting the request;
the Worker never executes an uploaded document.

## Voice input, read-aloud & web search

- **Read-aloud (🔊) is free forever.** It uses the browser's built-in speech engine: no API call, no key, nothing
  goes through the Worker. How it sounds depends on the voices the device has.
- **Voice input (🎙️) is free within Groq's free-tier rate limits** (see
  [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits); they change, so no numbers are
  copied here). The app calls Groq directly if the visitor pasted a Groq key in ⚙ Keys, and otherwise goes through
  this Worker's `/api/transcribe`. It needs one of the two, and the browser only offers the microphone on
  `https://` (or `localhost`). The text is added to the question box and never sent automatically.
- **Web search needs your own Tavily key** (⚙ Keys). It is a tool, so it is used only when 🔧 Tools is on, in Fast or Balanced
  mode (never Council). With no key, or once the monthly allowance is used up, the search returns a plain message to the
  model, which then answers without it. The answer isn't broken, and no error is shown.
- **The header shows a Tavily dot on the same red / amber / green scheme as the AI providers** (three plain circles; the words
  are in each dot's tooltip): red = no key or the key was
  rejected, amber = not checked yet or rate-limited / allowance used up, green = Tavily accepted the key. The check uses
  Tavily's own `GET /usage` endpoint, which spends no search, so it can run on every page load; the tooltip shows the plan's
  usage (for example "12 of 1,000 searches used"). The ⚙ Keys **Test** button uses the same free check.
- **Search isn't limited to trusted sites, so information isn't cut off, but nothing unvetted is passed off as trusted.** Every
  result is labelled with the kind of source it is, and anything not on the trusted list is marked **unverified**: the model is
  told which is which and asked to say so when it relies on an unverified source, and the answer gets a "Web search" box listing
  every result with ⚠ against the unverified ones (so the note appears even if the model forgets to mention it).

## Connect the app

In the app: **⚙ Keys → 🔒 proxy card** — paste the Worker URL (no trailing slash) and, if you
set one, the `PROXY_TOKEN`, tick **Remember** so they survive a reload, and click Test.

A key you paste directly into a provider card always wins over the proxy for that provider,
so leave a provider's card empty to route it through the Worker.

The public site no longer offers SambaNova: its API blocks browser calls and now requires
paid billing. (The Worker still knows the `sambanova` route if you have a paid key.)

## Trusted-source check (Council mode)

When Council models **disagree** and you have added a Tavily key, the app looks for sources and shows a green **Source check**
box: a short model-written summary of what the sources say, and under it the list of real sources found. It never changes
the answer, and it runs only after a disagreement because it spends **two** searches from your own monthly allowance.

Two searches run in the browser: one **restricted to the trusted list**, and one over **the whole web**, so information isn't cut
off. Results are merged with trusted ones first. Every source is labelled: a trusted one with its kind (below), anything else
marked **⚠ not on the trusted list (unverified)**. If no trusted source turns up, the box says so and that everything listed is
unverified. The summary model is told which sources are which and to say so when a point rests on an unverified source only.

The trusted list is the four static groups built into the page (`TRUSTED_STATIC`, which must be kept in step with the Worker's
lists; the tests compare them), plus the IFCN and CISA parts fetched from the Worker's public `GET /trusted-domains`. If that Worker
is unreachable, or has no KV set up, only the static groups are used, so a visitor loses the IFCN fact-checkers but keeps the
legislative, historical, scientific and general sources.

### What each group is, and what it does and doesn't tell you

These are **not interchangeable kinds of trust**, and the box labels each source so they aren't mixed up.

| Kind | Domains | What being on the list means | Licence |
|---|---|---|---|
| **general** | official statistics, health, science and intergovernmental bodies: `cdc.gov`, `nih.gov`, `fda.gov`, `nasa.gov`, `noaa.gov`, `census.gov`, `gov.uk`, `ons.gov.uk`, `nhs.uk`, `who.int`, `un.org`, `europa.eu`, `oecd.org`, `worldbank.org`, `imf.org` and a few more (see `GENERAL_TRUSTED_DOMAINS`) | a real document published by that institution | varies by site; US federal works are generally public domain |
| **legislative** | `congress.gov` (US bills and statutes), `legislation.gov.uk` (UK statutes), plus my additions `govinfo.gov` (US Code, Federal Register) and `eur-lex.europa.eu` (EU law) | primary-source law text, *not* reporting about law | US government works: generally public domain. UK: Crown copyright under the Open Government Licence. EU: see EUR-Lex's own reuse notice |
| **historical** | `loc.gov` and `chroniclingamerica.loc.gov` (Library of Congress archives and digitised newspapers), plus my addition `archives.gov` (US National Archives) | a digitised primary record, e.g. what a 1920s newspaper printed | rights vary item by item; the Library of Congress publishes a rights statement per item |
| **scientific** | `pubmed.ncbi.nlm.nih.gov` and `www.ncbi.nlm.nih.gov` (NIH/NLM), `doaj.org` (Directory of Open Access Journals) | a real paper or record in an index with a genuine vetting step: PubMed only indexes journals that pass an editorial selection process, and DOAJ is a curated whitelist built to screen out predatory journals. This is the strongest signal of the static groups, and it is *still* about the journal, not about each paper being right | PubMed abstracts stay under their publishers' copyright; DOAJ lists open-access journals, each with its own licence |
| **fact-check** (IFCN) | the ~150 *verified* signatories of the International Fact-Checking Network, refreshed weekly | an organisation whose fact-checking practice was independently assessed against the IFCN code of principles. **This is the only group that reports a claim's truth** (a fact-checker's verdict), and it is that organisation's assessment, not a settled fact. Being a signatory doesn't mean everything the outlet publishes has been fact-checked | the public directory; only domain names are stored |
| **government** (government / regulator) | two parts: **(1)** a small slice of CISA's registry of federal `.gov` domains, refreshed weekly from KV; **(2)** `KNOWN_REGULATOR_DOMAINS`, a short curated list of statutory and regulatory bodies that are *not* on a `.gov` domain (see below) | a real site of a public authority: a department, agency or regulator. It says who published the page, not that a particular page is right | CISA data: public domain (CC0). The regulator list is just domain names |

The honest distinction: **general, legislative, historical, scientific and government** confirm that a page *really is a
document from that institution*. Only **fact-check** is about a claim having been *checked and found true or false*, and
only in that fact-checker's judgement. A statute site tells you what the law's text says, not that an AI's summary of it is
right; a journal index tells you a paper exists in a vetted journal, not that its finding is true. The source check shows
what the documents say and leaves the conclusion to you. Nothing is stored or republished: only the search snippets Tavily
returns are shown, with a link.

### The "Government / Regulator source" label

Government sources are also marked with a small violet **🏛️ Government / Regulator source** pill next to the individual citation,
in the source list under the source-check summary and in the Web search list under an answer that used the 🔧 web search tool
(and in text form in the tool-calls part of the workings). It is a citation-level tag, deliberately a different colour from the
amber "models disagreed" box and the green "source check" box, and it is applied **automatically when a result's own domain
matches**, whether the search was trusted-only or open. That is deterministic matching against the lists, never a guess, and a
result on no list carries no label at all. A domain that is both a `.gov` site and in the general group (`cdc.gov`, `nih.gov`) is
reported as government, the more specific description.

What counts as government / regulator here is exactly:

- **the CISA-derived `.gov` domains** (the federal science, health, statistics, law and records slice held in KV), and
- **`KNOWN_REGULATOR_DOMAINS`** in `worker/src/index.js` (mirrored in `index.html`): UK `fca.org.uk`, `ico.org.uk`, `ofcom.org.uk`,
  `cqc.org.uk`, `gmc-uk.org`, `nmc.org.uk`, `sra.org.uk`, `frc.org.uk`, `bankofengland.co.uk`, `electoralcommission.org.uk`; EU agencies
  `ema`, `efsa`, `esma`, `eba`, `edpb` and `ecb` on `europa.eu`; and `cnil.fr`, `dataprotection.ie`, `priv.gc.ca`, `asic.gov.au`,
  `accc.gov.au`, `tga.gov.au`, `oaic.gov.au`.

**That regulator list is a starting point, not a complete or authoritative register.** It is short, leans towards the UK, EU and
Commonwealth, and will miss regulators and public bodies that matter in your own jurisdiction or field, and `.gov` only covers the
US. A missing regulator simply shows as an unverified source, so if this matters to you, **extend the list** for your jurisdiction
(add the domain to `KNOWN_REGULATOR_DOMAINS` in the Worker and to the copy in `index.html`, which the tests compare). Only add real
public authorities, not trade bodies or self-regulating clubs, and remember that a badge means "published by an authority", not
"correct". Other badges (fact-checker, legislative and so on) can be added later by adding an entry to `SOURCE_LABELS` in `index.html`
and a colour; the underlying categories already exist.

**Left out on purpose: Crossref.** It is a metadata-only API (DOIs, titles, reference lists) with no browsable content of its
own, so a search restricted to it would return nothing readable, and a DOI just points at whichever publisher hosts the paper,
which says nothing about that publisher's reliability.

### How the list is built and kept fresh

The static groups are fixed in `worker/src/index.js` (edit and redeploy). The IFCN and CISA lists live in a KV namespace
(`TRUSTED_KV`) and are refreshed by a **weekly cron (04:00 UTC every Monday)**. Both are switched on in this repo's
`wrangler.toml`. The namespace id in it belongs to the site owner's Cloudflare account, so anyone deploying their own copy must
run `npx wrangler kv namespace create TRUSTED_KV` and put their own id there, or delete the two blocks, in which case the app
simply uses the static groups. To refresh right now instead of waiting for Monday, or to check the state:

```bash
curl -X POST https://ai-council-proxy.<you>.workers.dev/trusted -H "X-Proxy-Token: <your PROXY_TOKEN>"
curl https://ai-council-proxy.<you>.workers.dev/trusted -H "X-Proxy-Token: <your PROXY_TOKEN>"   # sizes and last refresh
```

- **IFCN:** the signatory list has no official download. The Worker reads the JSON endpoint the IFCN website itself loads
  (undocumented, so it could change). Only verified, non-expired signatories are kept ("In Renewal" and "Expired" are not).
- **CISA:** the registry lists about 1,300 federal domains, four times Tavily's cap, and isn't a quality ranking. So only
  agencies whose job is science, health, statistics, law or records are considered, and at most two domains are kept per agency
  (its shortest names, which are usually the main site). That is a heuristic, which is why the important sites are also
  named explicitly in the static groups.
- **A refresh can't blank the list.** Each list is replaced only if the new one looks sane (a minimum size); otherwise the
  old list stays and the failure is recorded (`meta` in `GET /trusted`).
- **The 300-domain cap.** Tavily allows at most 300 `include_domains`. Merge order is static groups, then IFCN, then CISA. If the
  total ever goes over, the tail is dropped **and a warning is logged** saying how many of which kind were lost. With live data
  at the time of writing the merged list is **239 domains** (53 static, 148 IFCN, 38 CISA after removing duplicates), so this
  doesn't trigger today. Note that the CISA slice is the first thing to lose out if IFCN grows.

## Query compression & token counter

**Token counter (⚙ Keys → 📊 Token usage).** A table of calls counted, prompt, completion and total tokens per provider, for the
current session (in memory; it resets on reload, and there's a Reset button). These are **real numbers the provider itself
reports** in its response (`usage`), not an estimate and not something a model says about its own output. Known gap, shown in
the UI rather than hidden: streamed replies only carry usage if the provider honours `stream_options: {include_usage: true}`
(part of the OpenAI API spec, but not every OpenAI-compatible provider takes it). The app asks for it, drops it for the rest of
the session for any provider that rejects it, and counts a stream with no usage in the **No usage data** column instead of
guessing. So the totals cover only calls where the provider reported usage; some streamed responses may not be in them. The
non-streamed calls (routing, critique, memory, the tool loop) are counted for every provider that reports usage.

**Query compression (🗜️ Compress in the header).** **Opt-in and off by default**, not remembered between visits. When on, a long
question is first shortened by one call to the fast Groq model (using a system prompt of the site owner's own wording, kept
verbatim in `COMPRESSION_SYSTEM_PROMPT`), and the shorter version stands in for your question through routing, generation, the
Council fanout, critique and the source check. The trade-off is real:

- **Cost:** one extra model call per question.
- **Benefit:** fewer input tokens on every later call, so it mainly pays off in **Council mode**, where several models each read
  the question. In Fast mode there are only two or three calls, so the extra one rarely pays for itself.
- **Risk:** compression is lossy and a model decides what counts as filler, so it can drop something you meant. Both versions
  are always shown in the "Show the council's workings" panel ("Compressed question"), never a silent substitution.
- **Safe failure:** if compression is skipped, times out, fails, replies without the `<compressed_prompt>` tag, or isn't actually
  shorter, your original question is used unchanged and the workings say why. A question under 30 words is left alone.
- Your **original** words are still what's shown and saved in the chat, and what the plain-language rewrite (which honours
  requests like "in one sentence"), the medical/legal/financial check and memory work from.

## Global question counter

The same Worker keeps the running total of questions asked on the site (shown at the bottom of the
sidebar as e.g. `12.3K`, `1.2Mi`, `3Bi`). It needs no secret and no extra setup: `wrangler deploy` creates the
storage (one SQLite-backed Durable Object, available on the free plan) from the `[[durable_objects]]` and
`[[migrations]]` blocks in `wrangler.toml`.

| Call | Who | What |
|---|---|---|
| `GET /count` | the website (allowed origin) | returns `{"total": n}` (may be up to ~15 s stale) |
| `POST /count` | the website (allowed origin) | adds one, returns the new `{"total": n}`; `429` if rate-limited |
| `PUT /count` | **you only** (`X-Proxy-Token`) | sets the total, e.g. to reset or seed it |

```bash
# reset the counter to zero (or seed it with a starting number)
curl -X PUT https://ai-council-proxy.<you>.workers.dev/count -H "X-Proxy-Token: <your PROXY_TOKEN>" -d '{"total":0}'
```

Limits: 20 increments per minute per IP address and 600 per minute overall, so one client can't inflate the
number and a flood can't use up the free Durable Objects allowance. The IP address is only held in memory to apply
the limit. Counts are indicative, not audited.

## Security notes

- `ALLOWED_ORIGIN` in `wrangler.toml` must be your site's exact origin. Requests from any
  other origin are rejected, so other websites can't spend your keys.
- Set `PROXY_TOKEN`. The app keeps it in memory only, unless you tick **Remember** on the proxy card, in which
  case it is stored in that browser's `localStorage` (treat it like an API key).
- A provider with no key in the browser *and* no secret on the Worker will show an error in the council and be skipped; set the secret or ignore it.
- Only the six listed providers, plus `transcribe`, are reachable; there is no open forwarding.

Copyright (c) 2026 O. T. Dowling. All rights reserved. See the LICENSE file in the repository root.
