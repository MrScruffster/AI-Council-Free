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

## What's new

- **🔌 More one-click providers** – Alibaba Cloud (Qwen), Meta Llama API, Hugging Face, Pollinations (optional key) and BazaarLink (with a visible third-party caution), and custom providers can now genuinely work without a key.

- **📁 Folders, tags and search** – sort chats into your own folders, add free-text tags, and search the sidebar across titles, tags and message text. All in this browser; older chats keep working untouched.
- **⬇ Export and print** – on any open chat, download it as one self-contained HTML file (no scripts, no external requests, no API keys) or use 🖨 Print / Save as PDF.
- **✨ Starter templates** – eight one-click prompt templates on the empty-chat screen; they only fill in the message box, never send.
- **📲 Installable app** – the UI can be installed to your home screen or desktop and its shell loads offline. This is the *interface* only: AI answers always need an internet connection and your API keys, and the service worker never caches API calls.

- **▶ Run code** – Python and JavaScript code blocks get a Run button. Everything executes inside your browser in a sandbox (a sandboxed iframe / Web Worker; Python via Pyodide, downloaded only on your first Python run). Nothing is sent anywhere, and the code can't see this page or your API keys.
- **🧩 Structured (JSON) output** – ask for the answer in a JSON shape you choose (a JSON Schema or a small example) in Fast/Balanced mode. It uses each provider's native JSON mode where one exists and falls back to instructions; enforcement is best-effort and depends on provider support, and the reply is always validated in your browser, with a clear warning if it doesn't match.
