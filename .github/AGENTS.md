# CI workflows: agent instructions

Area guide for `.github/`: the GitHub Actions workflows, the composite action they share, and Dependabot. The plan
these follow, with its measurements and the phases still open, is [`proposals/ci-workflows.md`](../proposals/ci-workflows.md).

## Layout

| File                                       | Runs on                         | Does                                                                                     |
| ------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `workflows/ci.yml`                         | pull requests, pushes to `main` | every check, behind the one required check `CI result`                                   |
| `workflows/reusable-e2e-extension.yml`     | called by `ci.yml`, on demand   | the browser extension's E2E suite                                                        |
| `workflows/reusable-e2e-vscode.yml`        | called by `ci.yml`, on demand   | the VS Code extension's integration suite                                                |
| `workflows/reusable-jetbrains.yml`         | called by `ci.yml`, on demand   | the JetBrains plugin's tests, build and Plugin Verifier runs                             |
| `workflows/reusable-e2e-desktop.yml`       | called by `ci.yml`, on demand   | the desktop shell's Rust tests and E2E smoke test, on macOS                              |
| `workflows/pr-lint.yml`                    | pull requests                   | `commitlint`, `title` (the PR title) and `actionlint`                                    |
| `workflows/docs.yml`                       | pushes to `main`                | builds and deploys the docs and the demo                                                 |
| `workflows/release-please.yml`             | pushes to `main`                | the release PR, and the tag once it merges                                               |
| `workflows/publish*.yml`, `desktop-release.yml` | release tags              | npm, container, NuGet, desktop, VS Code, JetBrains and browser-extension publications    |
| `workflows/changelog-polish.yml`           | releases                        | tidies the release notes                                                                 |
| `workflows/live-jira.yml`                  | on demand                       | the live Jira E2E                                                                        |
| `actions/setup-workspace/action.yml`       | used by the workflows above     | Node, the npm cache, `npm ci`, and Playwright's Chromium when asked                      |

`ci.yml`'s `changes` job reads which areas a change touches (`dorny/paths-filter`) and each job runs for the areas it
covers; a change to `.github/workflows/`, `.github/actions/` or `.node-version` runs them all. The editor, extension and
desktop suites run on pull requests only. The release PR runs the `Versions` job alone.

## Conventions

- **One required check.** A new check is a job of `ci.yml` (or a reusable workflow it calls) listed in the `needs` of
  `CI result`, never a separate required check. A job skipped by its `if` counts as passed; a workflow its path filter
  never started stays pending, so gate jobs on `needs.changes.outputs.*`, not workflows on `paths`.
- **A job that runs on some events and not others is never a required check of the same name** in another run on the
  same commit: the latest run of a check is the one branch protection reads. `pr-lint.yml` runs every job on every
  event for this reason.
- **Node through `setup-workspace`.** The version comes from the root `.node-version`; a job names another only to test
  a floor (`engines`, Node 22) or a bundled runtime (the desktop's `24.4.1`). `npm ci` runs with
  `--prefer-offline --no-audit --fund=false`. The release workflows (`publish*.yml`, `desktop-release.yml`) still set
  Node up themselves, until phase 4 of the proposal moves them to `release.yml`.
- **Playwright's headless shell is cached by Playwright version** (`playwright: shell`). The full Chromium build
  (`playwright: full`) is installed on every run: its workflows run on pull requests only, where a cache serves its own
  pull request alone.
- **Least privilege.** `permissions: contents: read` on every workflow; anything more on the job that needs it.
- **Bounded.** `timeout-minutes` on every job, about three times its usual duration.
- **Readable.** A `name` on every step, and a `name:` on every workflow that says what it does.
- **Superseded runs cancelled.** Every pull-request workflow has
  `concurrency: { group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: true }`.
  A reusable workflow has none: there `github.workflow` is the caller's name, so its group would collide with the
  caller's and cancel the run.
- **Artifacts expire.** An explicit `retention-days` on every artifact: 1 day for the ones jobs hand to each other.
- **Comments state the rule** the workflow follows, as everywhere in the repository (see the root `AGENTS.md`).

## Checking a change

- Run `actionlint` before pushing (`pr-lint.yml` runs it on every pull request):
  `docker run --rm -v "$PWD:/repo" -w /repo -e SHELLCHECK_OPTS=--severity=warning rhysd/actionlint:1.7.12 -color`.
  It runs shellcheck on the `run` scripts, at the warning level.
- A change under `.github/workflows/` or `.github/actions/` runs every suite on its pull request, which exercises it.
  The release workflows run only on a tag: run them with `workflow_dispatch` on a branch, where they build without
  publishing.
- Dependabot updates the actions of the workflows and of `.github/actions/*`.
