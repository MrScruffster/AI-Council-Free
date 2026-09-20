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

Secret names: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`,
`COHERE_API_KEY`, `SAMBANOVA_API_KEY`, `MISTRAL_API_KEY`.

## Connect the app

In the app: **⚙ Keys → 🔒 proxy card** — paste the Worker URL (no trailing slash) and, if you
set one, the `PROXY_TOKEN`. Click Test.

A key you paste directly into a provider card always wins over the proxy for that provider,
so leave a provider's card empty to route it through the Worker.

The public site no longer offers SambaNova: its API blocks browser calls and now requires
paid billing. (The Worker still knows the `sambanova` route if you have a paid key.)

## Security notes

- `ALLOWED_ORIGIN` in `wrangler.toml` must be your site's exact origin. Requests from any
  other origin are rejected, so other websites can't spend your keys.
- Set `PROXY_TOKEN`. The app keeps the token in memory only (never saved), so re-enter it after reloading the page.
- A provider with no key in the browser *and* no secret on the Worker will show an error in the council and be skipped; set the secret or ignore it.
- Only the seven listed providers are reachable; there is no open forwarding.

Copyright (c) 2026 O. T. Dowling. All rights reserved. See the LICENSE file in the repository root.
