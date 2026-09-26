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

Run events fire when a run finishes or fails, cluster events when a failure cluster appears, is fixed or regresses,
and others on a flakiness spike, a performance regression, a finished AI diagnosis and an auto-heal pull request.
Each event, when it fires and the payload it carries are in
[Notification events & webhooks](/reference/notification-events). A
[report schedule](./quality-reports#report-schedules) sends its report to the channels it names, with no subscription.

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

Piwi `POST`s a JSON body to your URL, signed with an HMAC-SHA256 `X-Piwi-Signature` header derived from the channel's
secret. The body, its fields and how to verify the signature are in
[Notification events & webhooks](/reference/notification-events#webhook-body).

### Reaching the person who fixed it

When an [SCM token](/guide/source-control) is configured, `cluster.fixed` and `cluster.regressed` resolve the fixing commit's author through the provider (for a regression, the author of the fix that did not hold). On top of the normal subscription routing, the event is then delivered to that person directly:

- **Email**, through the same outbox, when SMTP is configured **and** the commit's email belongs to a registered Piwi user. The mail goes to that user's account email, never to the raw commit address, so a fix by an outside contributor never becomes a mail to a stranger.
- **A browser notification** for that user, delivered even when they have no matching subscription.

Without a token, an exposed email or a successful lookup, subscriptions alone apply.

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
- [Notification events & webhooks](/reference/notification-events): every event and the webhook body
- [Quality reports](./quality-reports#report-schedules): scheduled quality reports sent to these channels
- [Failure clusters & the inbox](./failure-clusters): what triggers the cluster events
