---
title: Notifications & alerts
lang: en-US
---

# Notifications & alerts

Piwi can push run events to **email**, **Slack**, or **HTTP webhooks** so your team hears about failures, new failure clusters, flakiness spikes, and performance regressions without watching the dashboard.

::: tip
Notifications are gated on authentication — they activate only when [`PIWI_AUTH_ENABLED=true`](./authentication). Each subscription belongs to a user.
:::

## How it works

1. You create a **channel** (a destination: email address, Slack webhook, or HTTP webhook).
2. You create a **subscription** linking a channel to the events you care about, optionally scoped to a single project, with filters and a delivery mode.
3. When an event fires, Piwi matches active subscriptions, writes a delivery to an outbox table, and a scheduled task dispatches it with automatic retry/backoff.

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

## Channels

### Email

Requires SMTP to be configured (see below). Sends to a destination address.

### Slack

Create an [incoming webhook](https://api.slack.com/messaging/webhooks) in Slack and paste its URL. Messages are posted to the webhook's channel.

### Webhook

Piwi `POST`s a JSON payload to your URL. Each request is signed with an HMAC-SHA256 `X-Piwi-Signature` header derived from the channel's secret, so you can verify authenticity. Webhook secrets are encrypted at rest.

Admins can mark a channel **global** so it is available to all users.

## Subscriptions

A subscription controls *what* is delivered and *how*:

- **Events** — one or more of the events above.
- **Scope** — all projects, or a single project.
- **Filters** — by branch, status, or a numeric threshold (e.g. only notify on flakiness above N%).
- **Mode** — `realtime` (dispatched as events happen) or `digest` (batched, sent at a configured time).
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

- [Authentication](./authentication) — required for notifications
- [Configuration reference](./configuration) — all environment variables
- [AI diagnosis & failure clustering](./ai-diagnosis) — what triggers `cluster.new`
