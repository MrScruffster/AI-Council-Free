# AI Council (Free)

A single-page app that puts several free AI models to work together: route a question to a specialist, draft, critique, revise, or run a full council. Bring your own free API keys; everything runs in your browser. Live at <https://www.ai-council.co.uk>.

- `index.html` – the whole app (vanilla JS, no build step).
- `worker/` – optional Cloudflare Worker (shared counter, trusted-source lists, key proxy).
- `benchmark/` – the public hallucination-benchmark package (specs, public data, comparison maths).

## What's new

- **▶ Run code** – Python and JavaScript code blocks get a Run button. Everything executes inside your browser in a sandbox (a sandboxed iframe / Web Worker; Python via Pyodide, downloaded only on your first Python run). Nothing is sent anywhere, and the code can't see this page or your API keys.
- **🧩 Structured (JSON) output** – ask for the answer in a JSON shape you choose (a JSON Schema or a small example) in Fast/Balanced mode. It uses each provider's native JSON mode where one exists and falls back to instructions; enforcement is best-effort and depends on provider support, and the reply is always validated in your browser, with a clear warning if it doesn't match.
