---
title: Notifications & alerts
description: "Browser, email, Slack, Microsoft Teams and webhook channels, the events they fire on, and per-project subscriptions with digests and mute."
lang: en-US
---

# Notifications & alerts

<Needs reporter />

Piwi pushes run events to a **browser** tab, **email**, **Slack**, **Microsoft Teams** or an **HTTP webhook**, so your
team hears about failures, new failure clusters, flakiness spikes and performance regressions without watching the
dashboard.

## What it does

1. A **channel** is a destination: a browser tab, an email address, a Slack or Teams webhook, or your own URL.
2. A **subscription** links a channel to the events you care about, for every project or one, with filters and a
   delivery mode.
3. When an event fires, Piwi matches the active subscriptions and writes each delivery to an outbox, which a scheduled
   task sends with retries. A browser channel is delivered at once to every open dashboard tab.

## Where it is

**Settings → Notifications** manages channels and subscriptions, and the **bell** on a project page subscribes to that
project. Notifications need no authentication: with it off, the instance is single-tenant and every channel and
subscription is **global**. With `PIWI_AUTH_ENABLED=true` ([authentication](/operate/authentication)), each user keeps
their own, and administrators can add global ones shared by everyone.

## Events

| Event | Fires when |
|-------|------------|
| `run.finished` | A run completes (any status) |
| `run.failed` | A run completes with failures |
| `run.failed.default_branch` | A run fails on the repository's default branch |
| `cluster.new` | A new failure cluster appears |
| `cluster.fixed` | A run passes every test a cluster covers: the fix landed (a filtered re-run of just those tests counts). The payload's `verification` says whether the diagnosis was corroborated (`diagnosis-verified`) or the tests merely stopped failing, and `resolved` whether the triage status was closed automatically |
| `cluster.regressed` | A cluster with a recorded fix fails again; `reopened` says whether a *resolved* cluster was set back to open |
| `flakiness.spike` | A completed run contains flaky tests; the flakiness-threshold filter keeps only rates above N% |
| `perf.regression` | A run is at least 20% slower than the median of the previous five completed runs on the same branch and environment; the regression-% filter raises the bar |
| `diagnosis.completed` | An AI diagnosis finishes (requires an AI provider) |

**`report.ready`** needs no subscription: a [report schedule](./quality-reports#report-schedules) sends it to the channels it names, through the same outbox. Its webhook body adds the whole report: `{ "event", "payload": { "snapshotId", "scheduleId", "periodEnd", "url" }, "bundle", "timestamp" }`.

## Channels

### Browser

Sends native OS notifications to any open Piwi tab, even in the background, through the [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API); grant permission when prompted.

- **With authentication**: create a channel of type `browser` in **Settings → Notifications** and subscribe it to events; the stream then delivers exactly the events and projects your subscriptions cover.
- **Without authentication**: no channel is needed; the **bell** on each project page stores per-browser preferences (a cookie) for which events raise notifications.

The diagnosis panel toggles diagnosis completion notifications without deleting the subscription.

### Email

Requires SMTP to be configured (see below). Sends to a destination address.

### Slack

Create an [incoming webhook](https://api.slack.com/messaging/webhooks) in Slack and paste its URL. Messages are posted to the webhook's channel.

### Microsoft Teams

In the Teams channel, add the Workflows template *Post to a channel when a webhook request is received* (or a
legacy incoming webhook) and paste its URL. Each event, digest and
[quality report](./quality-reports#report-schedules) arrives as an Adaptive Card.

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

`headline` is the one-line explanation the dashboard builds from the Playwright error (the locator, its last state,
the expected and received values, the timeout; see [Failure evidence](./evidence#one-execution-diagnosis-first)),
absent when the case carries no error. `errorExcerpt` is the error's message head: at most five lines before the call
log and the stack trace, capped at 300 characters, plus the last `waiting for …` line when the head is only a bare
timeout. Slack and email messages lead with the headline, quote the excerpt and link each failure to its execution.
The [pull-request comment](/features/pr-feedback) quotes failures the same way.

`cluster.new` payloads similarly carry `sampleErrorExcerpt` (cut the same way) and `affectedCases`; `cluster.fixed` and `cluster.regressed` carry the cluster's `signature`, `title`, the `runId` that decided the verdict and, for a fix, the `commit` and `timeToResolutionMs`. To check the HMAC, sign the exact bytes you received, never a re-serialized payload.

### Reaching the person who fixed it

When an [SCM token](/guide/source-control) is configured, `cluster.fixed` and `cluster.regressed` resolve the fixing commit's author through the provider and add a `fixAuthor` object (`{ name, email }`) to the payload (`cluster.regressed` uses the author of the fix that did not hold). On top of the normal subscription routing, the event is then delivered to that person directly:

- **Email**, through the same outbox, when SMTP is configured **and** the commit's email belongs to a registered Piwi user. The mail goes to that user's account email, never to the raw commit address, so a fix by an outside contributor never becomes a mail to a stranger.
- **A browser notification** for that user, delivered even when they have no matching subscription.

Without a token, an exposed email or a successful lookup, `fixAuthor` is absent and subscriptions alone apply.

### Global channels & subscriptions

Admins can mark a channel **global** so it is available to all users, and mark a subscription **instance-wide** (from the project bell) so it delivers whoever is signed in: the way to route every failure to one team Slack channel. Global subscriptions must target a global channel. With authentication disabled, every channel and subscription is global.

## Subscriptions

A subscription controls *what* is delivered and *how*:

- **Events**: one or more of the events above.
- **Scope**: all projects, or a single project.
- **Filters**: by branch, status, **owner** (only when the run broke a test that team owns; see
  [Tags & ownership](/guide/concepts#tags-ownership)), or a numeric threshold (such as flakiness above N%).
- **Mode**: `realtime`, sent as events happen, or `digest`, held until the configured time and sent as **one combined
  message** per email, Slack or Teams channel.
- **Mute**: silence a subscription until a chosen time without deleting it.

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

## Limits

- **Digests group email, Slack and Teams only.** Webhook and browser deliveries are always one per event.
- **A browser channel needs an open tab.** Nothing reaches a closed browser; the
  [desktop app](./desktop) shows OS notifications while its window is in the background.
- **Email needs SMTP**, set through environment variables only.

## Related

- [CI & sharding](/guide/ci): the alternative, pulling the run URL into your pipeline
- [Authentication](/operate/authentication): per-user channels and subscriptions
- [Configuration reference](/reference/configuration): every environment variable
- [Quality reports](./quality-reports#report-schedules): scheduled quality reports sent to these channels
- [Failure clusters & the inbox](./failure-clusters): what triggers `cluster.new`, `cluster.fixed` and `cluster.regressed`
- [AI diagnosis](./ai-diagnosis): what triggers `diagnosis.completed`
