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

It is **off until an [administrator connects Jira](/operate/integrations#connecting-jira-cloud)**. With no connection,
none of the entry points below appear.

<div class="doc-screenshot">
  <img src="/screenshots/create-issue-modal.png" alt="The Create issue modal on a failure cluster: an editable title, the Jira project and issue-type fields, include toggles, and a preview of the fix-plan body">
</div>

## What it does, exactly

- **Create issue** appears on a failure cluster, on a failing execution, and on each inbox row (plus the `c` key and a
  *Create issues* button in the inbox bulk bar). It is the primary action while the cluster has no ticket; once one
  exists, the chip shows the key and status and the action becomes *Open in Jira*.
- The issue **body is the fix plan**, rendered to Atlassian Document Format: *What happened* (headline, error type,
  first/last seen, occurrences, affected tests with owners, branch, environment, commit), *Most likely* (the diagnosis
  and root cause, or the top clue when there is no diagnosis), *Evidence* (the error excerpt and failing locator),
  *What to do* (the suggested patch as a diff, the locator replacement, the verify command, reproduce steps), and
  *Links* back to Piwi. Every section degrades independently.
- Each issue carries the labels `piwi`, `piwi-cluster-<id>` and `piwi-fp-<hash>` and a `Piwi-Cluster: <id>` trailer, so
  a person or a JQL filter can find every Piwi-filed issue.
- **Filing is deduped by cluster.** A second click, a duplicate event, or the bulk action across an already-tracked
  cluster is a no-op. Before creating, the modal surfaces any issue that already tracks the failure — a pinned link, a
  matching label, or a *fixed-before* match — and leads with *link it instead*.
- Creating an issue is a **durable outbox action**: it is attempted immediately (so a click resolves in one
  round-trip), retried with backoff if Jira is unavailable, and recorded. `GET /api/integrations/actions?projectId=<id>`
  lists what Piwi wrote.

## The key travels

Once a cluster has a known issue, its key follows the failure everywhere:

- the **cluster state line** and the **inbox row** show the key with its status color;
- `cluster.new`, `cluster.fixed` and `cluster.regressed` **Slack and email** messages name it;
- the **pull-request feedback** comment says *tracked in PROJ-123* on each failure whose cluster has one;
- the **fix plan** lists it under *Links*, and the `get_cluster` / `get_fix_plan` MCP tools return it.

<div class="doc-screenshot">
  <img src="/screenshots/cluster-issue-chip.png" alt="A failure cluster's state line showing the linked Jira issue key with an Open in Jira action">
</div>

## Requirements

- A connected **Jira Cloud** site — see [Operate → Integrations](/operate/integrations#connecting-jira-cloud).
- **`PIWI_SITE_URL`** set, so the links in the issue body resolve back to the dashboard.
- **Reporter or administrator** access to create an issue or link one — the same roles that may pin a link. Any project
  member can read the key and status.

## Enable it

There is nothing to switch on beyond the connection. When the modal opens it prefills the Jira project, issue type,
labels and assignee from the project's binding when one exists, and otherwise offers pickers over the connected site.
Toggles choose what the body carries — the diagnosis and patch are on by default; a screenshot attachment and a
[share link](/features/share-links) are off.

From an AI agent, the [`create_issue` MCP tool](/features/mcp) files the same ticket from the fix plan it just read.

## Limits

- **Jira Cloud only** in this release (REST v3, email + API token). Jira Server / Data Center, GitHub Issues and GitLab
  Issues follow as provider files.
- **Manual creation only.** Automatic filing on `cluster.new` and two-way status sync arrive in later releases; the
  binding form and its policies are not yet exposed.
- A ticket's body is a **snapshot** at creation time — it does not rewrite itself as the cluster evolves.
- Attachments honor the [export size budget](/features/offline-export); the trace is never attached.
