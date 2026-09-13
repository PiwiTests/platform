---
title: Integrations
lang: en-US
---

# Integrations

Connect an issue tracker and the external links you pin to a run, execution or failure cluster stop being
dead URLs: Piwi fetches the ticket's title and status through the connection and keeps the badge current
when you refresh. Jira Cloud is the first tracker; the connection layer is shaped so more follow.

A connection is instance infrastructure — one row per external system, managed by an administrator, shared
by every project. Nothing is sent to Jira until a connection exists, and credentials are encrypted at rest
with `PIWI_SECRET_KEY`.

<div class="doc-screenshot">
  <img src="/screenshots/integrations-settings.png" alt="Settings → Integrations: a Jira card with a connected system, its verified status, and a test-connection button">
</div>

## Connecting Jira Cloud

Jira Cloud authenticates with an account email and an API token (REST v3, HTTP Basic).

1. Create an API token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)
   under **Security → API tokens**, signed in as the account whose permissions Piwi should act with.
2. Open **Settings → Integrations** (administrator only) and connect Jira with:
   - **Base URL** — your site, e.g. `https://your-team.atlassian.net`.
   - **Account email** — the Atlassian account the token belongs to.
   - **API token** — the token from step 1.
3. Click **Test connection**. Piwi calls `GET /rest/api/3/myself` and shows the account it resolved to, so
   you can confirm the credentials before relying on them.

Once connected, a Jira link — `https://your-team.atlassian.net/browse/PROJ-123`, including a self-hosted
host once its connection exists — is recognized as a Jira issue, unfurls with the summary and a status
badge (colored by the issue's status category), and refreshes through the connection.

## Environment-managed vs dashboard-managed

A connection can live in either place:

- **Dashboard-managed** — added on the Integrations page. Editable there; the credential is encrypted in
  the database and never returned by any endpoint. Saving with the token field left blank keeps the stored
  token.
- **Environment-managed** — created from the environment at startup when `PIWI_JIRA_BASE_URL`,
  `PIWI_JIRA_EMAIL` and `PIWI_JIRA_API_TOKEN` are all set. It shows a lock badge and is read-only in the
  dashboard: change it by editing the environment and restarting. The token stays in the environment and
  never enters the database.

See the [configuration reference](/reference/configuration#integrations) for the variables.

## Trusted base URLs and private hosts

A connection base URL is supplied by an administrator, so Piwi trusts it: a self-hosted tracker on a
private network — `https://jira.internal.example.com` or an RFC 1918 address — works without extra
configuration. Every URL a non-administrator supplies (pinning a link, for instance) still goes through the
SSRF guard that blocks private hosts.

## What unfurl gives today

With a connection in place, a pinned or refreshed Jira link carries:

- the issue **summary** as its title;
- a **status** badge whose color follows the issue's status category (to-do, in-progress, done);
- a refresh that reads the ticket back through the connection rather than scraping the page.

## Creating issues from a failure

Once a connection exists, Piwi can **file the ticket for you** — a Jira issue whose body is the failure's fix plan,
linked back as the cluster's known issue. See [Issue tracking (Jira)](/features/issue-tracking) for the create flow,
the fields, and how the key travels back into the inbox, notifications and pull-request comments.

A connection carries a **default language** for the tickets filed against it (a French Atlassian site can default them
to French); a project binding overrides it, and the create modal offers a per-issue choice — see
[Language](/features/issue-tracking#language).
