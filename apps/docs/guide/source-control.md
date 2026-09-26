---
title: Source control
description: "Connect the dashboard to your GitHub, GitLab or Bitbucket repository with an SCM token, and see which features read or write through it."
lang: en-US
---

# Source control

Piwi reads your repository through the Git host's API with an **SCM token** (a personal or project access token for
GitHub, GitLab or Bitbucket). Nothing needs it to store runs, but every feature that looks at the code behind a
failure, or writes back to a pull request, goes through it.

## What uses it

| Feature | What it does with the repository | Access |
|---|---|---|
| [AI diagnosis](/features/ai-diagnosis#scm-grounded-context) | Reads the commits and diffs since the last green run, and the full source of the most suspect files | read |
| The failure cluster's **What changed** panel | Lists commits, shows their diffs, and lets you pin a baseline commit | read |
| [Uncovered changes](/features/scenario-gaps) | Diffs the run's commit against its baseline and flags changed files no test reached | read |
| [Did the fix work?](/features/failure-clusters#did-the-fix-work) | Checks whether the commits after a fix touched the failing files | read |
| [Notifications](/features/notifications) | Names the author of the fixing commit on `cluster.fixed` and `cluster.regressed` | read |
| Ownership and the default branch | Reads `CODEOWNERS` for test owners, and the repository's default branch when the project sets none | read |
| [Pull-request feedback](/features/pr-feedback) | Posts a summary comment and a commit status | write |
| [Re-run in CI](/features/pr-feedback#re-run-from-the-dashboard) | Dispatches a workflow or pipeline | write |
| [Auto-heal PRs](/features/auto-heal) | Opens a pull request with a locator fix | write |

Every call is best-effort: a missing token, a private repository the token cannot see or an unreachable host is
logged, and the feature shows nothing rather than failing a run.

## Set the token

- **Instance-wide**: **Settings → AI → Repository access**. Every project uses it unless it has its own.
- **Per project**: the project's edit page, field **SCM token**. It overrides the instance-wide token for that
  project. Prefer one per project for write access: an instance-wide write token can write everywhere it reaches.

A token is stored encrypted with [`PIWI_SECRET_KEY`](/reference/configuration#general) and never returned by the API;
the field shows that one is stored. Leave the field empty to keep it, or save it empty to remove it.

Public repositories work without a token for the read features, within the host's rate limit for anonymous calls.
A private repository needs one.

### Which repository

Piwi takes the repository from the run: the reporter records the Git remote URL, the branch and the commit of the
checkout it runs in (see [SCM information](/reference/test-metadata#scm-information-git)). Supported hosts are
`github.com`, `gitlab.com` and self-hosted GitLab (a host name containing `gitlab`), and `bitbucket.org`. A run
without a remote URL has nothing to diff.

### Scopes

| Host | Read features | Write features |
|---|---|---|
| GitHub | read access to repository contents | `repo` (classic), or fine-grained `contents: write` and `pull_requests: write`; `actions: write` (classic `workflow`) for re-runs |
| GitLab | `read_api` | `api` |
| Bitbucket | repository read | repository write; `pipeline:write` for re-runs |

## Verify

Open a failure cluster from a run that has a commit. The **What changed** panel lists the commits since the last green
run. The diagnosis context preview (**Context sent to AI**) shows the same thing in its data coverage: when the SCM
section is absent, it says why.

## Troubleshooting

- **No commits or diff.** The coverage names the cause: no repository URL on the run, no SCM token, or the host's error.
  A 404 from GitHub on a private repository means the token cannot see it.
- **No baseline.** The diff starts at the last green run before the failure first appeared; a project with no green
  run falls back to the last run where the test passed, and a manual baseline commit overrides both.
- **No pull-request comment.** Pull-request feedback also needs `PIWI_SITE_URL` and a write-scoped token, and posts on
  GitHub and GitLab only.

## Related

- [AI provider](./ai-provider): the model that reads this context
- [Pull-request feedback & re-run](/features/pr-feedback): what gets posted on a pull request
- [Privacy & data flow](./privacy): what Piwi sends to your Git host
