# AI Council (Free)

A single-page app that puts several free AI models to work together: route a question to a specialist, draft, critique, revise, or run a full council. Bring your own free API keys; everything runs in your browser. Live at <https://www.ai-council.co.uk>.

- `index.html` – the whole app (vanilla JS, no build step).
- `worker/` – optional Cloudflare Worker (shared counter, trusted-source lists, key proxy).
- `benchmark/` – the public hallucination-benchmark package (specs, public data, comparison maths).

## What's new

- **📁 Folders, tags and search** – sort chats into your own folders, add free-text tags, and search the sidebar across titles, tags and message text. All in this browser; older chats keep working untouched.
- **⬇ Export and print** – on any open chat, download it as one self-contained HTML file (no scripts, no external requests, no API keys) or use 🖨 Print / Save as PDF.
- **✨ Starter templates** – eight one-click prompt templates on the empty-chat screen; they only fill in the message box, never send.
- **📲 Installable app** – the UI can be installed to your home screen or desktop and its shell loads offline. This is the *interface* only: AI answers always need an internet connection and your API keys, and the service worker never caches API calls.

- **▶ Run code** – Python and JavaScript code blocks get a Run button. Everything executes inside your browser in a sandbox (a sandboxed iframe / Web Worker; Python via Pyodide, downloaded only on your first Python run). Nothing is sent anywhere, and the code can't see this page or your API keys.
- **🧩 Structured (JSON) output** – ask for the answer in a JSON shape you choose (a JSON Schema or a small example) in Fast/Balanced mode. It uses each provider's native JSON mode where one exists and falls back to instructions; enforcement is best-effort and depends on provider support, and the reply is always validated in your browser, with a clear warning if it doesn't match.
