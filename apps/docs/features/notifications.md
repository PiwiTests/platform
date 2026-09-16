---
title: Notifications & alerts
lang: en-US
---

# Notifications & alerts

<Needs reporter />

Piwi can push run events to **browser**, **email**, **Slack**, or **HTTP webhooks** so your team hears about failures, new failure clusters, flakiness spikes, and performance regressions without watching the dashboard. AI diagnosis completions can also notify you when they finish.

Notifications do not require authentication. With auth disabled the instance is single-tenant, so every channel and subscription is **global** (instance-wide). With `PIWI_AUTH_ENABLED=true` ([see authentication](/operate/authentication)) each user manages their own channels and subscriptions, and administrators can additionally create global ones shared by everyone.

## How it works

1. You create a **channel** (a destination: browser tab, email address, Slack webhook, or HTTP webhook).
2. You create a **subscription** linking a channel to the events you care about, optionally scoped to a single project, with filters and a delivery mode.
3. When an event fires, Piwi matches active subscriptions, writes a delivery to an outbox table, and a scheduled task dispatches it with automatic retry/backoff. Browser channels are delivered immediately via SSE to any open dashboard tab.

Manage both from **Settings → Notifications**, and subscribe to a single project with the **bell** on the project page.

## Events

| Event | Fires when |
|-------|------------|
| `run.finished` | A run completes (any status) |
| `run.failed` | A run completes with failures |
| `run.failed.default_branch` | A run fails on the repository's default branch |
| `cluster.new` | A new failure cluster appears |
| `cluster.fixed` | A run passes every test a cluster covers — the fix landed (a filtered re-run of just those tests counts). The payload's `verification` says whether the diagnosis was corroborated (`diagnosis-verified`) or the tests merely stopped failing, and `resolved` whether the triage status was closed automatically |
| `cluster.regressed` | A cluster with a recorded fix fails again; `reopened` says whether a *resolved* cluster was set back to open |
| `flakiness.spike` | A completed run contains flaky tests — use the flakiness-threshold filter to only hear about rates above N% |
| `perf.regression` | A run is at least 20% slower than the median of the previous five completed runs on the same branch in the same environment — raise the bar per subscription with the regression-% filter |
| `diagnosis.completed` | An AI diagnosis finishes (requires an AI provider) |

## Channels

### Browser

Sends native OS notifications to any open Piwi tab, even when the tab is in the background. Notifications fire via the [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API); grant permission when prompted.

- **With authentication**: create a channel of type `browser` in **Settings → Notifications** and subscribe it to events; the stream then delivers exactly the events and projects your subscriptions cover.
- **Without authentication**: skip channels entirely — the **bell** on each project page stores per-browser preferences (a cookie) for which events raise notifications.

Diagnosis completion notifications can be toggled on/off from the diagnosis panel without deleting the subscription.

### Email

Requires SMTP to be configured (see below). Sends to a destination address.

### Slack

Create an [incoming webhook](https://api.slack.com/messaging/webhooks) in Slack and paste its URL. Messages are posted to the webhook's channel.

### Webhook

Piwi `POST`s a JSON payload to your URL. Each request is signed with an HMAC-SHA256 `X-Piwi-Signature` header derived from the channel's secret, so you can verify authenticity. Webhook secrets are encrypted at rest.

The body is `{ "event": "run.failed", "payload": { … }, "timestamp": "…" }`. For run events the payload includes up to three failing tests so you can act without a round-trip to the dashboard:

```json
{
  "event": "run.failed",
  "payload": {
    "runId": 42,
    "projectName": "checkout",
    "status": "failed",
    "totalTests": 120,
    "failedTests": 3,
    "branch": "main",
    "topFailures": [
      {
        "title": "applies discount code",
        "filePath": "tests/checkout.spec.ts",
        "headline": "getByRole('button', { name: 'Pay' }) never became enabled — click timed out after 30 s",
        "errorExcerpt": "TimeoutError: locator.click: Timeout 30000ms exceeded.\nlocator resolved to <button disabled>Pay</button>",
        "testCaseId": 815,
        "executionId": 9001
      }
    ]
  },
  "timestamp": "2026-07-11T10:00:00.000Z"
}
```

`headline` is the one-line explanation the dashboard builds from the Playwright error — the locator, the
last state its call log reported, the expected and received values, the timeout (see
[Failure evidence](./evidence#one-execution-diagnosis-first)); it is absent when the case carries no error.
`errorExcerpt` is the error's message head — the lines before Playwright's call log and the stack trace,
at most five, capped at 300 characters. When that head is only a bare timeout line, the last
`waiting for …` / `locator resolved to …` line of the call log is appended so the excerpt says what
Playwright was waiting on. Slack and email messages lead with the headline, quote the same excerpt, and link each failure to its
execution (`/test-run-cases/<executionId>`), falling back to the test's history page when a payload
carries no execution id. The [pull-request comment](/guide/ci#pull-request-feedback) quotes failures the same
way.

`cluster.new` payloads similarly carry `sampleErrorExcerpt` (cut the same way) and `affectedCases`; `cluster.fixed` and `cluster.regressed` carry the cluster's `signature`, `title`, the `runId` that decided the verdict and, for a fix, the `commit` and `timeToResolutionMs`. These fields are **additive** — existing consumers keep working, but if you re-serialize the payload to re-check the HMAC, sign the exact bytes you received.

### Reaching the person who fixed it

When an [SCM token](/guide/ci#pull-request-feedback) is configured, `cluster.fixed` and `cluster.regressed` resolve the fixing commit's author through the provider and add a `fixAuthor` object — `{ name, email }` — to the payload (`cluster.regressed` uses the author of the fix that did not hold). On top of the normal subscription routing, the event is then delivered to that person directly:

- **Email**, through the same outbox, when SMTP is configured **and** the commit's email belongs to a registered Piwi user. The mail goes to that user's account email, never to the raw commit address, so a fix by an outside contributor never becomes a mail to a stranger.
- **A browser notification** for that user, delivered even when they have no matching subscription.

`fixAuthor` is absent when no token is configured, the host exposes no email, or the lookup fails — the fix outcome then reaches people through subscriptions only.

### Global channels & subscriptions

Admins can mark a channel **global** so it is available to all users, and mark a subscription **instance-wide** (from the project bell) so it delivers regardless of who is signed in — the way to route every failure to one team Slack channel. Global subscriptions must target a global channel. With authentication disabled, every channel and subscription is global.

## Subscriptions

A subscription controls *what* is delivered and *how*:

- **Events** — one or more of the events above.
- **Scope** — all projects, or a single project.
- **Filters** — by branch, status, **owner** (deliver only when the run broke a test that team owns — see
  [Tags & ownership](/guide/concepts#tags-ownership)), or a numeric threshold (e.g. only notify on flakiness above N%).
- **Mode** — `realtime` (dispatched as events happen) or `digest` (held until the configured time, then sent as **one combined message** per email/Slack channel). Webhook and browser deliveries are always individual.
- **Mute** — silence a subscription until a chosen time without deleting it.

## SMTP configuration

Email channels and the account flows (verification, password reset, invites) need SMTP. Slack, webhook and browser channels work without it. SMTP is set via environment variables only and shown read-only in **Settings → Notifications**; `PIWI_SMTP_HOST` and `PIWI_SMTP_FROM` are enough for a relay that accepts unauthenticated mail:

```bash
PIWI_SMTP_HOST=smtp.example.com
PIWI_SMTP_PORT=587            # default 587
PIWI_SMTP_FROM=noreply@example.com
PIWI_SMTP_FROM_NAME=Piwi Dashboard   # optional display name
PIWI_SMTP_USER=apikey         # only when the server requires authentication
PIWI_SMTP_PASS=••••••••        # only when the server requires authentication; never returned by the API
PIWI_SMTP_SECURE=false        # true for port 465 (implicit TLS)
PIWI_SITE_URL=https://piwi.example.com   # base URL used in email links
```

Send a test email from **Settings → Notifications** to confirm delivery.

## See also

- [CI & sharding](/guide/ci) — the alternative: pull the run URL into your pipeline instead
- [Authentication](/operate/authentication) — per-user channels and subscriptions
- [Configuration reference](/reference/configuration) — all environment variables
- [AI diagnosis & failure clustering](./ai-diagnosis) — what triggers `cluster.new`, `cluster.fixed`, `cluster.regressed` and `diagnosis.completed`
