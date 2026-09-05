---
title: Failure clusters & the inbox
lang: en-US
---

# Failure clusters & the inbox

A run gives you a list of failures. The same root cause usually breaks several tests, and the same break
comes back run after run — so a list of failures is really a much shorter list of *problems*, repeated.
Piwi groups failures by that root cause into **failure clusters**, and the Home page turns those clusters
into a **failure inbox**: a queue of the problems you still owe a decision, not a wall of red to re-read
every morning.

For how clusters are formed (the error fingerprint) and diagnosed, see
[AI diagnosis & clustering](./ai-diagnosis#failure-clustering).

## The failure inbox

The **Failure inbox** on Home lists every open failure cluster across the projects you can see, newest
first. Each row is one cluster:

- the **headline** — the failure in one line;
- the **top clue** — a muted one-line hint at the likely cause (a timeout on a locator, a strict-mode
  match, a fix that regressed);
- the **owner or assignee** — who the failure belongs to (see [Owners](#owners-and-assignees) below);
- the **age** and the **affected-test count**;
- the exceptional **badges** only — a regression on the default branch, a fix that didn't hold, a
  quarantined cluster, a "snoozed, back" marker, a pending merge suggestion.

### Queues

The inbox is split into queues, each with a live count. Pick one to focus; **All open** is the default,
and the queue is shareable — it lives in the URL as `?queue=`.

| Queue | What it holds |
|---|---|
| **All open** | Every open, non-snoozed cluster. |
| **New** | Clusters first seen — or seen again — since you last opened the inbox (kept per browser, no account needed). |
| **Mine** | Clusters whose assignee, or whose derived owner, is you. |
| **Regressions** | Clusters that regressed on the project's default branch and are still failing there. |
| **Fix didn't hold** | Clusters whose fix landed and then regressed. |
| **Quarantine ready** | Quarantined clusters whose tests have stopped failing — safe to release. |
| **Merge suggestions** | Clusters that are part of a pending merge suggestion awaiting a decision (see [clustering](./ai-diagnosis#failure-clustering)). |

### Triage from the row or the keyboard

Every row can be triaged in place, and the whole inbox is keyboard-driven. Select a row with the mouse or
`j` / `k`, then:

| Key | Action |
|---|---|
| `o` | Open the cluster |
| `r` | Resolve |
| `i` | Ignore |
| `q` | Quarantine the cluster's tests |
| `a` | Assign |
| `s` | Snooze |
| `l` | Link a known issue |
| `x` | Select the row (`shift`+`j`/`k` extends the selection, `esc` clears it) |

With one or more rows selected, a **bulk bar** applies resolve, ignore, assign, snooze or quarantine to
all of them at once. Every action is optimistic and undoable for a few seconds — a toast with **Undo**
reverses it.

The keyboard hints are hidden on touch devices, where the row's action buttons are always visible.

## Owners and assignees

A cluster's **owner** is derived, not stored: it comes from the failing test's `piwi:owner` annotation, or
falls back to the repository's `CODEOWNERS`. You can override it by **assigning** the cluster to a person —
an assignee takes precedence over the derived owner, and the **Mine** queue matches either one against the
signed-in user (by name or email, best effort).

## Snoozing

Some failures are real but not now — a known flake you're waiting to reproduce, a break you'll get to next
sprint. **Snoozing** hides a cluster from every inbox queue without touching its status: a snoozed cluster
is still *open*, just out of sight.

Three durations are offered:

- **1 day** and **1 week** — the cluster returns when the deadline passes.
- **Until it recurs** — the cluster stays hidden until a new run fails it again, then returns to the **New**
  queue with a **snoozed, back** badge so you know it woke on its own.

Snooze never changes a cluster's triage status, and a snoozed cluster does not count as "failing now" in the
project health and portfolio views. The cluster page shows the snooze state in its triage control, with an
**Unsnooze** action to bring it back immediately.

## From an AI agent

The [MCP server](./mcp) exposes the same queue: `list_open_clusters` takes an optional `queue` argument
(`mine`, `regressions`, `fix-didnt-hold`, `quarantine-ready`, `merge-suggestions`) so an agent can pull the
same focused list the dashboard shows, then triage with `set_cluster_status`.
