---
title: Privacy & data flow
lang: en-US
---

# Privacy & data flow

Test results are unusually revealing: they carry your source paths, error messages, screenshots of your
app, network calls, and sometimes your git history. That's a good reason to know exactly where the
bytes go. This page is the inventory.

The short version: **Piwi makes no outbound network call you didn't configure.** There is no telemetry,
no usage analytics, no update check, no crash reporting, and no license or activation call. An instance
running on an air-gapped network works the same as one on the internet.

## What leaves your server

Every outbound connection Piwi can make is something you switched on:

| Destination | When | Carries |
|---|---|---|
| Your AI provider | Only if you configure [AI diagnosis](/features/ai-diagnosis) | The diagnosis context: error text, failing steps, the relevant git diff, and — if enabled — failure screenshots |
| Your git host | Only if you connect a repository with a token | API reads: commits and diffs for the project's repo |
| Your SMTP server | Only if you configure [email notifications](/features/notifications) | Notification and account emails |
| Your Slack / webhook URLs | Only for subscriptions you create | The event payload (run status, cluster, test names) |
| Your S3 endpoint | Only if you switch [storage](/operate/storage) to S3 | Trace files, HTML reports, attachments |
| Google / GitHub | Only if you enable [OAuth sign-in](/operate/authentication#oauth-google-github) | The standard OAuth exchange |

Nothing on that list has a default. With none of them configured, a Piwi instance talks to nobody.

The **AI provider** is the one worth pausing on, because it's the only case where your code and error
text can leave your network. It's opt-in, it goes only to the endpoint *you* set — including a local
model over Ollama or vLLM, in which case nothing leaves the machine at all — you can preview the exact
context before it's sent, and you can cap its size. See
[AI diagnosis → Privacy](/features/ai-diagnosis#privacy).

## What never leaves your server

- **Traces.** The Playwright trace viewer is bundled and served by your own instance at
  `/trace-viewer/`. Opening a trace from Piwi never uploads it anywhere — unlike sending a colleague to
  the hosted `trace.playwright.dev`.
- **The API reference.** `/docs` is rendered in-app from your instance's own OpenAPI spec, with no
  third-party CDN, so it works offline.
- **Screenshots, videos, HTML reports.** Stored on your disk or your S3 bucket, served by your instance.
- **HTML report execution.** Reports run with scripts enabled inside a CSP sandbox with a unique opaque origin. Piwi
  provides the report with an in-memory Web Storage facade so Playwright's settings UI works; it is discarded with the
  report document and cannot read the dashboard's cookies or local storage. Uploaded reports remain untrusted active
  content.
- **Your IDE mapping.** The [Open in IDE](/features/ide-integration) workspace root lives in your browser's
  local storage, because the source is on your machine, not the server's. It is never sent to the
  dashboard.

## What Piwi deliberately does not capture

Some data is skipped at the source, so it never exists to leak:

- **Input values.** The [capture fixtures](./capture-fixtures) record what an element *is* — role,
  accessible name, test id — never what was typed into it. A password field's value is never captured.
- **Storage and cookie values.** Page state records the *names* of `localStorage` /`sessionStorage`
  keys and their value lengths, and cookie names with their flags. Never the values.
- **Sensitive headers.** `Authorization`, `Cookie` and friends are masked server-side in the trace
  network view, and token-shaped strings in URLs and bodies are masked too — so a bearer token that
  appeared in a request doesn't end up readable in the dashboard.
- **Backend logs, in production.** The [backend-log integrations](./backend-logs) emit their header only
  in development and test environments by default.

## Secrets at rest

Credentials you store in the dashboard — AI API keys, SCM tokens, webhook signing secrets — are
encrypted with AES-256-GCM using `PIWI_SECRET_KEY`. **Set it in production.** With the variable unset,
Piwi falls back to a hardcoded default string that is published in this repository — the values are
encrypted, but against a key anyone can look up, so treat that as no protection at all.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

API keys are stored as SHA-256 hashes and shown exactly once, at creation. A leaked database gives an
attacker no usable key.

Secrets provided by environment variable are never written to the database and never returned by the
API — the settings UI shows them as read-only with a lock badge.

## The demo

The [live demo](https://piwitests.dev/demo/) has no backend. It runs the real application against
an in-browser SQLite database seeded with fake data, inside a service worker. Nothing you click there
reaches a server, and there is nothing for it to collect.

## Retention

Data you keep is data you're responsible for. Piwi can prune it for you: set `PIWI_RETENTION_DAYS` for
nightly automatic pruning of old runs and their files, or delete in bulk from **Settings → Storage**.
Deleting a run removes its executions, traces, reports, and any evidence payloads no longer referenced
by anything else. See [Storage → Data retention](/operate/storage#data-retention).

## Verifying any of this

You don't have to take the page's word for it. The source is MIT-licensed and the outbound surface is
small enough to audit: watch the container's egress, or read
[`server/utils/`](https://github.com/PiwiTests/platform/tree/main/apps/application/server/utils) — the AI
provider, SCM, SMTP, storage and notification clients are the only things there that open a socket.

## See also

- [Authentication](/operate/authentication) — roles, API keys, and project-level access
- [Deployment → Security](/operate/deployment#security) — hardening a public instance
- [Why Piwi?](./comparison#is-my-data-safe-does-piwi-phone-home) — the same question, short form
