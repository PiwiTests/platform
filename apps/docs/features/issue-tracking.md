---
title: Issue tracking (Jira)
lang: en-US
---

# Issue tracking (Jira)

<Needs reporter />

Piwi already ends an investigation with everything a ticket needs — a headline, the affected tests and their owners,
the diagnosis, a validated patch, the failing locator, the verify command. **Create issue** turns that into a Jira
issue in one click: the body is the fix plan, the issue is linked back as the cluster's *known issue*, and from then on
the key travels wherever the failure appears.

It is **off until an [administrator connects Jira](/operate/integrations#connecting-jira-cloud)**; with no connection,
none of the entry points appear.

<div class="doc-screenshot">
  <img src="/screenshots/create-issue-modal.png" alt="The Create issue modal on a failure cluster: an editable title, the Jira project and issue-type fields, include toggles, and a preview of the fix-plan body">
</div>

## What it does, exactly

- **Create issue** appears on a failure cluster, on a failing execution, and on each inbox row (plus the `c` key and a
  *Create issues* button in the inbox bulk bar). It is the primary action while the cluster has no ticket; once one
  exists, the chip shows the key and status and the action becomes *Open in Jira*.
- The issue **body is the fix plan**, rendered to Atlassian Document Format: *What happened*, *Most likely*, *Evidence*,
  *What to do* (patch, locator replacement, verify command, reproduce steps) and *Links* back to Piwi. Every section
  degrades independently.
- Each issue carries the labels `piwi`, `piwi-cluster-<id>` and `piwi-fp-<hash>` and a `Piwi-Cluster: <id>` trailer, so
  a person or a JQL filter can find every Piwi-filed issue.
- **Filing is deduped by cluster** — a second click or a duplicate event is a no-op — and before creating, the modal
  surfaces any issue that already tracks the failure (a pinned link, a matching label, or a *fixed-before* match) and
  leads with *link it instead*.
- Creating an issue is a **durable outbox action**: attempted immediately, retried with backoff if Jira is down, and
  recorded — `GET /api/integrations/actions` lists what Piwi wrote.

## The key travels

Once a cluster has a known issue, its key follows the failure everywhere:

- the **cluster state line** and the **inbox row** show the key with its status color;
- `cluster.new`, `cluster.fixed` and `cluster.regressed` **Slack and email** messages name it;
- the **pull-request feedback** comment says *tracked in PROJ-123* on each failure whose cluster has one;
- the **fix plan** lists it under *Links*, and the `get_cluster` / `get_fix_plan` MCP tools return it.

<div class="doc-screenshot">
  <img src="/screenshots/cluster-issue-chip.png" alt="A failure cluster's state line showing the linked Jira issue key with an Open in Jira action">
</div>

## Keep the ticket honest

Once a cluster carries a known issue, Piwi keeps the two in step. A background sync
([`PIWI_INTEGRATIONS_SYNC_MINUTES`](/reference/configuration), default 15 min) reads each tracked issue back and caches
its status, title and assignee — so a closed ticket stops showing as open (open clusters refresh every sweep, resolved
ones daily). On top of that, per-project **policies** — all **off by default**, each a durable deduped outbox action —
write back as the cluster evolves:

| When Piwi observes | What Piwi does |
|---|---|
| A cluster's **fix is verified** | Comments *Fix landed in run #N …*, and — with *transition on fix* — moves the issue. |
| A cluster **regresses** | Comments *Regressed in run #N …*, and optionally reopens the issue. |
| **New occurrences** on an open ticket | At most one comment a day: *Still failing — +N occurrences in M runs …*. |
| A cluster is **merged** | With *comment on merge*, notes it on both issues; the survivor inherits the links. |
| The **ticket moves to Done** | With *resolve on close*, resolves the cluster; otherwise its state line offers *Mark resolved — PROJ-123 is Done*. |
| The **ticket is reopened** | With *reopen on ticket reopen*, reopens a resolved cluster with a note. |

Every comment is written in the [ticket's language](#language). A Jira admin can also register an optional
[inbound webhook](/operate/integrations#registering-the-inbound-webhook) so a close or reopen reflects immediately; it
can only refresh a link, never create or transition. The failure inbox gains a **Needs ticket** queue — open clusters on
the default branch, older than the binding's age (default 2 days), with no issue.

## The project binding

An administrator binds a project under **Project → Settings → Issue tracker**: the connection, Jira project and issue
type, default labels and assignee, the [ticket language](#language), what a ticket carries, the policies above, and
**owner routes** — mapping a cluster's owner (`@acme/checkout`, an email) to a Jira project, component, assignee and
labels. The create-issue draft picks the first matching route and fills the rest from the defaults, so a team's failures
reach that team's destination. The **automatic-creation** fields are shown greyed out: stored, but inert — Piwi does not
file tickets on its own in this release.

<div class="doc-screenshot">
  <img src="/screenshots/project-integration-binding.png" alt="The project's Issue tracker settings: connection, Jira project and issue type, labels, sync-policy switches, an owner-routes table, and the greyed-out automatic-creation fields">
</div>

## Requirements

- A connected **Jira Cloud** site — see [Operate → Integrations](/operate/integrations#connecting-jira-cloud).
- **`PIWI_SITE_URL`** set, so the issue body's links resolve back to the dashboard.
- **Reporter or administrator** to create or link an issue; any project member can read the key and status.

## Enable it

There is nothing to switch on beyond the connection. The modal prefills the Jira project, issue type, labels and
assignee from the [project binding](#the-project-binding) when one exists, else offers pickers over the connected site;
toggles choose what the body carries (diagnosis and patch on, screenshot and [share link](/features/share-links) off).
From an AI agent, the [`create_issue` MCP tool](/features/mcp) files the same ticket.

## Language

A ticket is written for a team, so its language is a property of its **destination**. It resolves from the **project
binding**'s language, else the **connection**'s default (a French Atlassian site can default every ticket to French),
else **English**. The create modal offers a per-issue *Language* select and the `create_issue` MCP tool takes a
`locale`. **English and French ship today**; another language is one catalog file in `shared/integrations/messages/`.

Only the copy **Piwi authors** is translated — headings, fact labels, policy comments, dates and counts (via `Intl`).
Your data (test titles, error text, locators, paths, the verify command, the patch) is **never** translated. The model's
prose follows the separate [AI response-language setting](/features/ai-diagnosis#response-language), so a French ticket's
*Most likely* section reads in French too. Jira's issue types, priorities and statuses are addressed by id, so a
French-configured site works unchanged.

## Limits

- **Jira Cloud only** in this release (REST v3, email + API token); Server / Data Center, GitHub and GitLab Issues
  follow as provider files.
- **Creation stays manual** — Piwi syncs a ticket and files it on a click, but never files one on its own yet.
- A ticket's body is a **snapshot** at creation; the policies add comments and status changes rather than editing it.
- The dashboard's deterministic sentences (headline, story, clue, state line) are **English templates** that quote
  locators and Playwright terms, so they stay English even in a French ticket.
- Attachments honor the [export size budget](/features/offline-export); the trace is never attached.
