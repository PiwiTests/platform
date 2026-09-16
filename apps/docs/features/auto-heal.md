---
title: Auto-heal PRs
lang: en-US
---

# Auto-heal PRs

<Needs reporter scm llm />

When a locator breaks on your default branch and Piwi has high-confidence evidence for the replacement, it can open the
fix pull request itself: a branch, a one-line locator edit per broken call site, and a body that shows the change, the
score, where the replacement came from, and the command that verifies it. The CI gate runs on the PR like any other,
and [fix verification](./ai-diagnosis#did-the-fix-work) records the cluster as fixed once the tests pass.

It is **off by default**, and even once on it acts only on projects you list. Writing to your repository is the
strongest thing the dashboard does, so the posture is conservative by design.

## What it does, exactly

- Triggers only on a **full run on the default branch** — never a feature branch, and never a run reported from a
  heal branch (that would feed on itself).
- Edits are **deterministic one-line locator rewrites** taken from a passing run's captured snapshot. No
  AI-generated code is ever in the write path.
- Each edit must come from a stored snapshot (`prior-run`, `fingerprint`, or `cross-test`) and score at or above the
  configured minimum — or be a locator **you confirmed** in the picker.
- Before committing, Piwi re-reads each file at the branch head and only writes lines it can still match exactly. A
  line that has drifted is dropped, not guessed.
- One PR per run, batching every qualifying edit. A duplicate run never opens a second PR.

## Requirements

- **`PIWI_SITE_URL`** must be set, so the links in the PR body resolve.
- An **SCM token with write scope**, resolved the same way as [PR feedback](/guide/ci#pull-request-feedback): a per-project token, falling back
  to the global one. It needs:
  - **GitHub** — `repo` (classic), or a fine-grained token with `contents: write` + `pull_requests: write`.
  - **GitLab** — `api`.
  - **Bitbucket** — an access token that can write to the repository. Bitbucket Cloud has no draft pull requests, so
    the draft setting is ignored there.

Prefer a **per-project token** for auto-heal: the global token grants write everywhere it reaches.

## Enable it

Settings → Auto-heal (administrator only):

- **Enabled** — the master switch.
- **Projects** — the explicit allowlist. Auto-heal ignores any project not listed.
- **Minimum score** — the stability score an edit needs (default 80). A confirmed pick is always eligible.
- **Draft** — open PRs as drafts (default on; ignored on Bitbucket).
- **Max open PRs** — a per-project ceiling on simultaneously-open auto-heal PRs (default 3).
- **Branch prefix** / **commit message** — the branch namespace (default `piwi/heal/`) and the commit subject
  (default `test: heal broken locators`, a conventional-commit subject so your commit lint accepts it).

You can review what Piwi has opened per project through `GET /api/heal-actions?projectId=<id>`.

## Limits

- **GitHub and GitLab and Bitbucket** are supported; GitHub Enterprise is not.
- The default branch is resolved per project — an explicit setting in project settings, else the repository's default
  branch from the SCM provider, else `main` — so the "default branch only" guard applies even when the reporter
  recorded no `defaultBranch` in its metadata.
- Retries use progressive backoff and record the provider's own error on the action, so a failure is visible rather
  than silent.
