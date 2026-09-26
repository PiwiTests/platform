---
title: Failure clusters & the inbox
description: "Failures that share an error fingerprint grouped into one cluster, triaged once from the failure inbox with an owner, a known issue and snoozing."
lang: en-US
---

# Failure clusters & the inbox

<Needs reporter />

One root cause usually breaks several tests, run after run. Piwi groups failures by root cause into **failure clusters**, and Home turns them
into a **failure inbox**: the problems you still owe a decision.

## How failures are grouped

Failed executions that share the same **error fingerprint** join one cluster, so twenty stack traces read as
*"20 failures, 3 root causes"*. Clustering is always on and needs no configuration.

- The fingerprint **masks volatile fragments** of the error: timeouts and other numbers, UUIDs and hashes, URLs and
  emails, the *expected* and *received* values of an assertion, and dynamic locator options such as the
  `{ name: '…' }` of a table row. The locator target itself (the test id, the role) still tells different failures apart.
- It is **call-site agnostic**: the failing stack frame is shown for context but does not split a cluster, so one root
  cause reached from several spec files stays one cluster.
- The fingerprint is always computed from the error the cluster was created from, so an improved normalization
  regroups clusters in place and keeps their triage, notes and diagnoses.
- The run page marks each cluster with **flaky** and **worker-correlation** heuristics: "the app is broken" versus
  "worker 3 is misbehaving".

<figure>
  <img src="/diagrams/failure-clustering-fingerprint.svg" alt="The fingerprint pipeline: a raw error is normalized, hashed and routed to one cluster">
</figure>

With an embedding model configured, near-duplicate clusters that the fingerprint keeps apart are merged too: see
[semantic merging](./ai-diagnosis#semantic-merging-optional).

## The failure inbox

The **Failure inbox** on Home lists every open failure cluster across the projects you can see, newest
first. Each row shows the cluster's **headline**, its **top clue**, the **owner or assignee**, the **age**, the
**affected-test count**, and only the exceptional **badges**, such as a regression on the default branch.

### Queues

The inbox is split into queues, each with a live count, shareable in the URL as `?queue=`.

| Queue | What it holds |
|---|---|
| **All open** | Every open, non-snoozed cluster. |
| **New** | Clusters first seen, or seen again, since you last opened the inbox (kept per browser). |
| **Mine** | Clusters whose assignee, or derived owner, is you. |
| **Needs ticket** | Untracked default-branch clusters older than 2 days, by default; see [issue tracking](./issue-tracking). |
| **Regressions** | Clusters that regressed on the default branch and are still failing there. |
| **Fix didn't hold** | Clusters whose fix landed then regressed. |
| **Quarantine ready** | Quarantined clusters whose tests stopped failing. |
| **Merge suggestions** | Clusters in a pending merge suggestion (see [semantic merging](./ai-diagnosis#semantic-merging-optional)). |

### Triage from the row or the keyboard

Every row can be triaged in place. Select a row with the mouse or `j` / `k`, then: `o` open, `r` resolve, `i` ignore,
`q` quarantine the cluster's tests, `a` assign, `s` snooze, `l` link a known issue, `c` create a Jira issue (when a
tracker is connected). `x` selects rows for a **bulk bar** that applies the same actions to all of them. Every action is undoable for a few
seconds.

Linking a known issue (`l`) pins a URL; with an [issue tracker connected](/operate/integrations), Jira links unfurl
and stay in sync, and you can **[file the issue from the failure](/features/issue-tracking)** (`c`).

## Owners and assignees

A cluster's **owner** is derived, not stored: it comes from the failing test's `piwi:owner` annotation, or
falls back to the repository's `CODEOWNERS`. You can override it by **assigning** the cluster to a person:
an assignee takes precedence over the derived owner, and the **Mine** queue matches either one against the
signed-in user (by name or email, best effort).

## The cluster page

A cluster page leads with the same situation block as a failing execution ([Your first
failure](/guide/first-failure)), across every test that shares the failure. The heading is the cluster's name (its
[AI title](./ai-diagnosis) when one exists), and three lines are specific to a cluster:

- **The occurrence sparkline**: how often it failed across recent runs, *N occurrences in M tests over D · last X ago*.
- **What changed**: the commits and files between the last passing run (or your baseline) and this failure, with
  **See the changes** leading to the diff, or **Browse commits** when there is nothing to diff.
- **The state line**, below.

The **Affected tests** list selects which test's latest execution the evidence shows. The diagnosis, the locator fix,
verify and reproduce sit in the folded [**More ways to fix**](./fix-plans#more-ways-to-fix) toolbox.

### The state line

The cluster page states where a cluster stands in **one sentence with one verb**, next to a colored dot:
*still failing*, *fixed and verified, still open*, *stopped failing*, *regressed, the fix did not hold*,
*resolved*, *ignored*, *snoozed* or *all tests quarantined*. When the verdict the runs showed and the status a person
set disagree, the line offers the **one action** that reconciles them (*Mark resolved*, *Reopen*, *Unsnooze*,
*Release*). Beside it, **Triage** sets the status (open / resolved / ignored), a note and the assignee, and **Snooze**
hides or brings back the cluster.

### Occurrences over time

A chart counts the cluster's failures per day, week or month, marking when its **fix landed**.

## Did the fix work?

When a run executes every test a cluster covers and they all pass, Piwi records the fix: the run, the commit, and how
long the cluster was open. Three verdicts, because they are not the same claim:

| Verdict | Means |
|---|---|
| **Stopped failing** | The tests pass again. A flaky test can achieve this by accident. |
| **Diagnosis verified** | The commits since the last failing run touched a file the [suggested patch](./ai-diagnosis#what-a-diagnosis-contains) named. |
| **Regressed** | A fix was recorded, and the cluster is failing again. |

**Every affected test must pass**: a test that did not run counts against the fix. A filtered run can close a cluster
if it covered all of it, so `--grep` over exactly the affected tests is enough.

The verdict moves the status only on strong evidence: *Diagnosis verified* sets an **open** cluster **resolved**, and
*Regressed* sets a **resolved** one back to **open**, each adding a line to the triage note. *Stopped failing* alone
changes nothing, and an *ignored* cluster is never touched. The [notifications](./notifications) `cluster.fixed` and
`cluster.regressed` follow the verdict, and with [pull-request feedback](./pr-feedback) on, the comment gains a
**Fixed by this change** section, even with *only comment on failures* set.

## Snoozing

**Snoozing** hides a cluster from every inbox queue without touching its status: it is still *open*. **1 day** and
**1 week** return it when the deadline passes; **Until it recurs** returns it to the **New** queue, with a **snoozed,
back** badge, when a new run fails it again.

## From an AI agent

Over the [MCP server](/features/mcp), `list_open_clusters` takes the same `queue` argument, and `set_cluster_status`
triages.

## Related

- [Triage a run gone red](/recipes/mass-failure): the clusters, used to collapse a red run into a few causes
- [AI diagnosis](./ai-diagnosis): an explanation of a cluster against your git diff
- [Failure evidence](./evidence): everything captured about one execution in the cluster
- [Core concepts](/guide/concepts#error-fingerprint-failure-cluster): fingerprint and failure cluster
