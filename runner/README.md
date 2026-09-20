# AI Council browser runner

This is an optional local companion service for the Agent mode roadmap. It
uses Playwright in a task-scoped, headless browser context and exposes a small
authenticated HTTP API on `127.0.0.1`.

## Setup

```powershell
npm install
npx playwright install chromium
$env:AIC_RUNNER_TOKEN = "use-a-long-random-local-token"
npm start
```

The token must be sent in the `X-AI-Council-Token` header. The service refuses
to start without one.

## Supported commands

- `POST /v1/tasks` with `{ "domains": ["example.com"] }`
- `POST /v1/tasks/:id/action` with `open`, `extract`, `search`, `fill`,
  `screenshot`, or `submit`
- `POST /v1/tasks/:id/stop`
- `GET /health`

Form submission always returns `confirmationRequired` unless `confirm: true`
is supplied, and remains disabled in this first release. The runner does not
execute shell commands, access local files, control the desktop, or receive
provider API keys.

## Security model

Every task has an explicit domain allowlist and a ten-minute expiry. URLs must
use HTTPS. Localhost, private IP ranges, link-local addresses and cloud
metadata hosts are rejected. A request route guard applies the same URL checks
to browser subrequests, and stopping or expiring a task closes its browser
context.
