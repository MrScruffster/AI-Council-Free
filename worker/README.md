# AI Council proxy (Cloudflare Worker)

Holds your provider API keys server-side and forwards the app's requests. Needed for
SambaNova (it blocks browser calls); optional for everything else.

## Deploy (about 5 minutes, free Cloudflare account is enough)

```bash
cd worker
npx wrangler login
npx wrangler deploy                      # prints https://ai-council-proxy.<you>.workers.dev

# add only the providers you use (each prompts for the key):
npx wrangler secret put SAMBANOVA_API_KEY
npx wrangler secret put GROQ_API_KEY     # optional, etc.

# recommended: a shared token so only your browser can use the Worker
npx wrangler secret put PROXY_TOKEN
```

Secret names: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`,
`COHERE_API_KEY`, `SAMBANOVA_API_KEY`, `MISTRAL_API_KEY`.

## Connect the app

In the app: **⚙ Keys → 🔒 proxy card** — paste the Worker URL (no trailing slash) and, if you
set one, the `PROXY_TOKEN`. Click Test.

A key you paste directly into a provider card always wins over the proxy for that provider,
so leave SambaNova's card empty to route it through the Worker.

## Security notes

- `ALLOWED_ORIGIN` in `wrangler.toml` must be your site's exact origin. Requests from any
  other origin are rejected, so other websites can't spend your keys.
- Set `PROXY_TOKEN`. The app keeps the token in memory only (never saved), so re-enter it after reloading the page.
- A provider with no key in the browser *and* no secret on the Worker will show an error in the council and be skipped; set the secret or ignore it.
- Only the seven listed providers are reachable; there is no open forwarding.
