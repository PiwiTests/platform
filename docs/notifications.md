---
title: Notifications & alerts
lang: en-US
---

# Notifications & alerts

Piwi can push run events to **browser**, **email**, **Slack**, or **HTTP webhooks** so your team hears about failures, new failure clusters, flakiness spikes, and performance regressions without watching the dashboard. AI diagnosis completions can also notify you when they finish.

Browser notifications work even with auth disabled — the other channel types require `PIWI_AUTH_ENABLED=true` ([see authentication](./authentication)).

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
| `flakiness.spike` | Flakiness rises above the configured threshold |
| `perf.regression` | A performance regression is detected |
| `diagnosis.completed` | An AI diagnosis finishes (requires an AI provider) |

## Channels

### Browser

Sends native OS notifications to any open Piwi tab, even when the tab is in the background. No configuration needed — create a channel of type `browser` and subscribe to events. Notifications fire via the [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API); grant permission when prompted.

Diagnosis completion notifications can be toggled on/off from the diagnosis panel without deleting the subscription.

::: tip
Browser notifications work without authentication. For email/Slack/webhook channels, [authentication must be enabled](./authentication).
:::

### Email

Requires SMTP to be configured (see below). Sends to a destination address.

### Slack

Piwi posts to Slack through an [incoming webhook](https://api.slack.com/messaging/webhooks) — a URL Slack gives you that is bound to one channel. Nothing is installed on the Slack side beyond the app that owns the webhook, and Piwi never reads from Slack.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and **Create New App → From scratch**. Name it (e.g. `Piwi`) and pick your workspace. Reuse an existing app if you already have one.
2. Open **Incoming Webhooks** in the sidebar and turn **Activate Incoming Webhooks** on.
3. Click **Add New Webhook to Workspace**, choose the channel the alerts should land in, and **Allow**. Slack needs an admin to approve the app in workspaces that restrict app installation.
4. Copy the generated URL — it looks like `https://hooks.slack.com/services/T…/B…/…`.
5. In Piwi, go to **Settings → Notifications → Notification channels → Add channel**, pick type **Slack webhook**, paste the URL and save.
6. Press the **send** button on the new channel to post a test message, then subscribe it to the events you care about.

The destination channel is baked into the webhook, so to alert several Slack channels create one webhook — and one Piwi channel — per destination.

::: warning
A webhook URL is a credential — anyone holding it can post to your Slack channel. Piwi never returns it once saved (the channels API redacts it, so you cannot re-read it from the dashboard), but it is stored unencrypted in the database, so treat database and backup access accordingly. To rotate or revoke, delete the webhook in Slack, then delete the channel in Piwi and create both again.
:::

Run failures arrive with up to three failing tests, each linking straight to the test case in the dashboard, and `cluster.new` messages link to the cluster. Set `PIWI_SITE_URL` so those links point at your instance instead of `localhost`.

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
        "errorExcerpt": "TimeoutError: locator.click: Timeout 30000ms exceeded",
        "testCaseId": 815,
        "executionId": 9001
      }
    ]
  },
  "timestamp": "2026-07-11T10:00:00.000Z"
}
```

`cluster.new` payloads similarly carry `sampleErrorExcerpt` and `affectedCases`. These fields are **additive** — existing consumers keep working, but if you re-serialize the payload to re-check the HMAC, sign the exact bytes you received.

Admins can mark a channel **global** so it is available to all users.

## Subscriptions

A subscription controls *what* is delivered and *how*:

- **Events** — one or more of the events above.
- **Scope** — all projects, or a single project.
- **Filters** — by branch, status, **owner** (deliver only when the run broke a test that team owns — see
  [Tags & ownership](./concepts#tags--ownership)), or a numeric threshold (e.g. only notify on flakiness above N%).
- **Mode** — `realtime` (dispatched as events happen) or `digest` (batched, sent at a configured time). Browser channels only support `realtime`.
- **Mute** — silence a subscription until a chosen time without deleting it.

## SMTP configuration

Email channels and the account flows (verification, password reset, invites) need SMTP. These are set via environment variables only and shown read-only in **Settings → Notifications**:

```bash
PIWI_SMTP_HOST=smtp.example.com
PIWI_SMTP_PORT=587            # default 587
PIWI_SMTP_USER=apikey
PIWI_SMTP_PASS=••••••••        # never returned by the API
PIWI_SMTP_FROM=noreply@example.com
PIWI_SMTP_FROM_NAME=Piwi Dashboard   # optional display name
PIWI_SMTP_SECURE=false        # true for port 465 (implicit TLS)
PIWI_SITE_URL=https://piwi.example.com   # base URL used in email links
```

Send a test email from **Settings → Notifications** to confirm delivery.

## See also

- [CI & sharding](./ci) — the alternative: pull the run URL into your pipeline instead
- [Authentication](./authentication) — required for non-browser notifications
- [Configuration reference](./configuration) — all environment variables
- [AI diagnosis & failure clustering](./ai-diagnosis) — what triggers `cluster.new` and `diagnosis.completed`
