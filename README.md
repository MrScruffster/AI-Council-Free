# AI Council (Free)

A single-page app that puts several free AI models to work together: route a question to a specialist, draft, critique, revise, or run a full council. Bring your own free API keys; everything runs in your browser. Live at <https://www.ai-council.co.uk>.

- `index.html` – the whole app (vanilla JS, no build step).
- `worker/` – optional Cloudflare Worker (shared counter, trusted-source lists, key proxy).
- `benchmark/` – the public hallucination-benchmark package (specs, public data, comparison maths).

## Adding a provider this template doesn't include

Open **⚙ Keys → ＋ Add a custom OpenAI-compatible provider**. Everything is bring-your-own-key: your key stays in this browser and goes straight to the provider (there is no Worker route, secret or server-side change for any of these).

One-click presets (they pre-fill the endpoint, request style and a "where to get a key" note):

- **Claude** and **ChatGPT** with your own key.
- **Alibaba Cloud (Qwen)** – separate DashScope API key; paste your own per-workspace endpoint URL or keep the default international one. Free trial credits vary by account and region.
- **Meta Llama API** – access may still be gated or waitlisted.
- **Hugging Face Inference** – `hf_…` token; small monthly free allowance, no card.
- **Pollinations** – the key is **optional**: leave it blank to use it anonymously (free, rate-limited; their docs now describe a key for higher limits, so anonymous access may be restricted later).
- **BazaarLink** – **an unverified third party.** A small, less-established gateway that isn't affiliated with the other providers: you trust it with your traffic like any custom endpoint, but it hasn't been vetted, so look at who is behind it before adding a key you care about. The form shows the same caution.

For anything not listed, choose "OpenAI-compatible", paste the provider's HTTPS chat-completions URL, a model ID and your key (leave the key blank only for services that need none, such as a local Ollama). Every message and your saved memory facts are sent to that address, so only add endpoints you trust.

## Optional extras

All bring-your-own-key and client-side: paste a key in ⚙ Keys, it is called straight from your browser (no Worker, no shared secret), and it is only remembered if you tick "Remember". With no key, nothing changes.

- **🔊 ElevenLabs voice (free tier, no card)** – a natural voice for Read aloud, with a voice picker. The free tier is about 10,000 characters a month, so verify the current limits at elevenlabs.io/pricing. If ElevenLabs ever fails or the allowance runs out, the browser's own voice takes over.
- **🔧 TinyFish "fetch a live page" (free, no card)** – reads one page with real browser rendering, for JavaScript-heavy or bot-protected sites. Free, no card, for their Search/Fetch endpoints as of their public docs; verify this is still accurate before relying on it. It complements Tavily search: search finds pages, this reads one.
- **💷 Bright Data "fetch a blocked page" (PAID)** – reads a page through Bright Data's Web Unlocker. **This is a paid, metered service billed by Bright Data directly based on your usage; AI Council doesn't track or limit it for you.** Only add a key if you already have a Bright Data account and understand their pricing. It needs an API key *and* a Web Unlocker zone name, and it starts switched off until you tick it.

Both page tools only exist for the model when their key is set, work in Fast/Balanced (never Council), and treat the fetched page as untrusted text.

## What's new

- **📋 Copy and 👍/👎 ratings** – every code block has a Copy button; every answer has Copy answer and thumbs up/down. Ratings are logged in this browser only (timestamp, session, message number, code/text, length, estimated tokens, latency, mode) and ⬇ Ratings downloads them as a CSV. Never the question or answer text.
- **🔊 Optional extras** – ElevenLabs voice for Read aloud, TinyFish and Bright Data page-reading tools (Bright Data is paid); see above.
- **📊 Benchmark on the About page** – what the planned 700-question hallucination benchmark is, with a clearly marked SAMPLE graphic. No benchmark has been run yet.
- **🔌 More one-click providers** – Alibaba Cloud (Qwen), Meta Llama API, Hugging Face, Pollinations (optional key) and BazaarLink (with a visible third-party caution), and custom providers can now genuinely work without a key.

- **📁 Folders, tags and search** – sort chats into your own folders, add free-text tags, and search the sidebar across titles, tags and message text. All in this browser; older chats keep working untouched.
- **⬇ Export and print** – on any open chat, download it as one self-contained HTML file (no scripts, no external requests, no API keys) or use 🖨 Print / Save as PDF.
- **✨ Starter templates** – eight one-click prompt templates on the empty-chat screen; they only fill in the message box, never send.
- **📲 Installable app** – the UI can be installed to your home screen or desktop and its shell loads offline. This is the *interface* only: AI answers always need an internet connection and your API keys, and the service worker never caches API calls.

- **▶ Run code** – Python and JavaScript code blocks get a Run button. Everything executes inside your browser in a sandbox (a sandboxed iframe / Web Worker; Python via Pyodide, downloaded only on your first Python run). Nothing is sent anywhere, and the code can't see this page or your API keys.
- **🧩 Structured (JSON) output** – ask for the answer in a JSON shape you choose (a JSON Schema or a small example) in Fast/Balanced mode. It uses each provider's native JSON mode where one exists and falls back to instructions; enforcement is best-effort and depends on provider support, and the reply is always validated in your browser, with a clear warning if it doesn't match.
- **🤖 Agent mode (safe first phase)** – the council creates a validated task plan, shows risks and expected results, and requires approval before each permitted read-only step. Approved steps can use the existing calculator, date/time, web-search, and (when configured) isolated browser tools; every action appears in an audit history and the persistent Stop agent control cancels the task. Form submission remains disabled.
- **🗳️ Structured Council decisions** – Council synthesis returns typed JSON containing the merged answer, per-provider agree/disagree/unclear votes, disagreement notes, and confidence. The answer bubble shows the vote counts and reported conflicts, while the full decision is retained in the workings.
- **🌐 Local browser runner (optional, first phase)** – `runner/` contains an authenticated Playwright companion service for isolated, task-scoped browser contexts. It supports approved HTTPS navigation, visible-text extraction, screenshots and form filling; private addresses, non-allowlisted domains and form submission are blocked. See `runner/README.md`; the frontend does not send provider keys to the runner.

## Local browser runner

The runner is deliberately separate from the static website. It listens only on
`127.0.0.1`, requires an `AIC_RUNNER_TOKEN`, creates a fresh browser context per
task, expires tasks after ten minutes, and closes a context when stopped. It
accepts only HTTPS URLs in the task allowlist and blocks localhost, private,
link-local and cloud-metadata addresses.

```powershell
cd runner
npm install
npx playwright install chromium
$env:AIC_RUNNER_TOKEN = "use-a-long-random-local-token"
npm start
```

The runner API is intended for a future frontend integration. It does not
receive provider API keys and its first release does not submit forms, execute
shell commands, access files, or control the desktop. Run its security tests
with `npm test`.
