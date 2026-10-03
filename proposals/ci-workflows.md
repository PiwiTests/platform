# CI workflows: cost and organization

A plan to cut the runner time the GitHub Actions workflows spend and the time a pull request waits for them, and to give
the eighteen workflow files one organization and one set of conventions. Every figure below comes from the GitHub
Actions API: the 200 workflow runs between 2026-10-02 15:22 and 2026-10-03 06:15 UTC, about 15 hours, 12 pull requests
and 8 merges to `main`.

**Status.** Proposed 2026-10-03. **Phase 1 built 2026-10-03**: the release PR runs one version check instead of the
suites, every pull-request workflow cancels its superseded runs, every job has a timeout and every workflow declares
its token permissions, the Playwright browser cache is keyed on the Playwright version, commitlint installs from the npm
cache without install scripts, and the extension E2E flake is fixed. What changed while building phase 1:

- The PR title check still runs when a PR's body is edited. Skipping it on body edits would let an edit turn a failed
  title check green: the latest run of a check is the one a required check reads.
- The extension E2E keeps installing Chromium on every run. It runs on pull requests only, and a cache a pull request
  saves serves that pull request alone; one entry per pull request (about 170 MB) would push the caches `main` saves
  out of the repository's 10 GB.
- The flaky test (`bug-report.spec.ts`, "keeps the viewport the steps were played at…") pressed the bug HUD's buttons
  from the keyboard while the HUD was being drawn again: a recording draws its HUD twice as it attaches to a page, and
  a redraw dropped the focus. A redraw now keeps the focus on the button that had it. A second cause stays open: the
  surfaces are hidden with `visibility: hidden` while a step's screenshot is taken, which also drops the focus. The test
  waits for a shown HUD; the product fix is to hide for a screenshot in a way that keeps the focus (`opacity: 0`),
  separately from the hide of a pick, which must also let the pointer through.

## What we measured

| Workflow                 | Runs | Median (success) | Note                                                      |
| ------------------------ | ---: | ---------------: | --------------------------------------------------------- |
| `ci` (pull_request)      |   30 |         12.3 min | 27 jobs per run; 6 runs cancelled by a newer push         |
| `ci` (push to `main`)    |    8 |         13.6 min | runs again everything the pull request already passed     |
| Lint PR title            |   45 |          0.4 min | runs again on every edit of the release PR                |
| Lint commits             |   29 |          0.8 min | a full `npm ci` without the npm cache                     |
| JetBrains Plugin         |   16 |          6.5 min | 5 jobs; the Gradle cache is never written                 |
| Extension E2E            |   16 |         16.1 min | one worker, 437 tests in 13.6 min; 3 failures out of 16   |
| Desktop E2E              |   16 |          7.0 min | macOS; builds the Nuxt server again (2.3 min)             |
| VS Code E2E              |   16 |          1.0 min |                                                           |
| Publish Container Image  |    8 |          4.5 min | a multi-arch `edge` image on every push to `main`         |
| Deploy Docs & Demo       |    8 |          2.0 min |                                                           |

**Runner minutes** below are the sum of every job's duration: the machine time spent. **Wall-clock time** is what a
developer waits, from the run's start to its last job.

One `ci` run on a pull request (run 37101083957) is **27 jobs, about 80 runner minutes and 11 minutes of wall-clock
time**. The E2E matrix (4 storage and database pairs, called backends below, × 5 shards) is 20 of those jobs and about
65 runner minutes, **80 % of the run**; each E2E job spends about 3.3 minutes in Playwright and 40 seconds getting
ready. The `checks` job runs lint, typecheck and unit tests in sequence in 7.3 minutes, 162 seconds of them the
application's unit tests and 104 seconds the reporter's. The account runs at most 20 jobs at once (5 on macOS), so a
single `ci` run already queues: jobs waited up to 208 seconds to start.

Each merge to `main` costs about **210 runner minutes**, because it also updates the release PR. release-please rewrites
the version in `apps/desktop`, `apps/jetbrains`, `apps/vscode`, `apps/extension` and `package-lock.json`, so every
path-filtered workflow ran on the release PR although no code changed:

| Started by one merge                     | Jobs | Runner minutes |
| ---------------------------------------- | ---: | -------------: |
| `ci` on `main`                           |   27 |            ~80 |
| The release PR (8 workflows)             |  ~36 |           ~120 |
| `edge` image, docs, release-please       |    5 |            ~10 |

Over the window, about **4,100 runner minutes**: about 960 (23 %) on the release PR and about 720 (18 %) on pushes to
`main`.

## Causes, by what fixing them saves

1. **The release PR is tested like a code PR**, on every merge. The two Extension E2E failures on it were therefore
   flakes, not regressions.
2. **The full E2E matrix runs on every pull request.** Storage and database are independent axes in the code:
   `local + sqlite` and `s3 + postgres` run each implementation at least once. The two crossed pairs add next to
   nothing on a pull request and cost 10 jobs.
3. **`ci` runs again in full on `main`** after a pull request that passed it.
4. **The path-filtered workflows had no `concurrency`**: a push left the previous commit's runs going, up to 16 minutes
   for Extension E2E.
5. **The Gradle cache is never written.** `gradle/actions/setup-gradle` writes it on the default branch only, and
   `jetbrains.yml` never runs there (the job log says `Cache is read-only`). Each `verify` job downloads about 935 MB of
   plugins and dependencies.
6. **The Playwright browser cache was keyed on `package-lock.json`**: any dependency update, and every release,
   missed it.
7. **Extension E2E runs on one worker with no retry**: 13.6 minutes, 5.1 of them in `replay.spec.ts`, and one flaky
   test fails the job.
8. **Desktop E2E builds the server on macOS**, where `desktop-release.yml` shows a Linux build is enough
   (`stage-server.mjs` adds the native modules of each OS).
9. **A release builds the `node-server` output twice** (`publish.yml` and `desktop-release.yml`).

## What is uneven in the organization

- **Names**: `ci`, `release-please`, `live-jira` lower case; `Desktop E2E`, `Lint commits` title case.
  `Publish Container Image` also publishes `@piwitests/reporter` and `@piwitests/server` to npm.
- **npm publishing in two files**: reporter and server in `publish.yml`, the Nitro instrumentation in
  `publish-instrumentation.yml`.
- **The Node setup is copied about twenty times** with variations: `node-version` `24`, `'24'`, `22`, `24.4.1`; npm
  cache or not; `npm ci` with or without `--prefer-offline --no-audit --fund=false`.
- **Steps without a `name`** in commitlint, publish-instrumentation, publish-nuget, desktop-e2e and desktop-release.
- **`defaults.run.working-directory: ./apps/application`** in `ci.yml`, overridden by `working-directory: .` on most
  steps.
- **Nothing checks the docs build or the Dockerfile on a pull request**, and nothing lints the workflows themselves.

## Target organization

```
.github/
  AGENTS.md                      Area guide: the conventions below (linked from the root AGENTS.md)
  actions/
    setup-workspace/action.yml   Composite action: Node, npm cache, npm ci, Playwright browsers on request
  workflows/
    ci.yml                       Pull requests and main: every check, one required check "CI result"
    pr-lint.yml                  Pull requests: title, commits, actionlint when .github/** changes
    nightly.yml                  Scheduled: the exhaustive matrices (D2, D4) and cache seeding
    release-please.yml           Push to main
    release.yml                  Tag v*: every publication
    release-notes.yml            Release published (today changelog-polish.yml)
    docs.yml                     Push to main: docs and demo deployment
    live-jira.yml                Manual
    reusable-e2e-extension.yml   Reusable workflows (workflow_call), called by ci.yml
    reusable-e2e-vscode.yml
    reusable-e2e-desktop.yml
    reusable-jetbrains.yml
    reusable-publish-npm.yml     reporter, server and the Nitro instrumentation
    reusable-publish-container.yml
    reusable-publish-nuget.yml
    reusable-publish-desktop.yml
    reusable-publish-vscode.yml
    reusable-publish-jetbrains.yml
    reusable-publish-extension.yml
```

GitHub takes no subfolder in `workflows/`: the `reusable-` prefix groups the reusable workflows in the list.

**Conventions** (to write down in `.github/AGENTS.md`):

- A readable `name:` that matches the file (`CI`, `PR lint`, `Release`, `Nightly`…).
- `permissions: contents: read` on the workflow; anything more on the job that needs it.
- `timeout-minutes` on every job and a `name` on every step.
- Node set up only through `.github/actions/setup-workspace`, its version read from a root `.node-version`; an explicit
  version only where a job tests a floor (`engines`, Node 22) or a bundled runtime (desktop, `24.4.1`).
- `concurrency` with cancellation on every pull-request workflow:
  `group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}`. Never in a reusable workflow:
  there `github.workflow` is the caller's name, so the group collides with the caller's and the run cancels itself.
- An explicit `retention-days` on every artifact (1 day for the ones jobs hand to each other).
- A new check is added to the `needs` of `CI result`, never as a separate required check.

## Phases

Each phase is one pull request, measured before and after with the same API queries as above.

### Phase 1: quick wins, no new structure (built)

- [x] The release PR: the heavy jobs of `ci.yml`, `desktop-e2e.yml`, `extension-e2e.yml`, `vscode-e2e.yml` and
      `jetbrains.yml` skip it (`if: ${{ !startsWith(github.head_ref, 'release-please--') }}`), and a
      `Release PR versions` job runs `npm ci` (which fails on a lockfile out of step) and
      `scripts/check-release-versions.mjs`. A job skipped by its `if` counts as passed for a required check, where a
      workflow its path filter never started stays pending.
- [x] `scripts/check-release-versions.mjs` also runs in the `checks` job of every pull request.
- [x] `concurrency` with cancellation on desktop-e2e, extension-e2e, vscode-e2e, jetbrains, commitlint and the PR title
      check; `ci.yml` groups by pull request number too.
- [x] The Playwright browser cache key is the OS, the `playwright-core` version and the build (`shell`); the demo job
      uses it too.
- [x] commitlint: npm cache, `npm ci --ignore-scripts`.
- [x] `timeout-minutes` on every job and `permissions` on every workflow.
- [x] The extension E2E flake (see Status).

### Phase 2: structure (risk: the required checks change)

- [ ] The `setup-workspace` composite action and the root `.node-version`, replacing the copied setup blocks.
- [ ] A `changes` job in `ci.yml` (`dorny/paths-filter`, or a `git diff --name-only` script to avoid a third-party
      action) with these outputs:
      - `app`: `apps/application/**`, `packages/{core,picker-dom,reporter,server}/**`, `integrations/nitro/**`,
        `package-lock.json`, `scripts/package-smoke.mjs`
      - `extension`: `apps/extension/**`, `packages/{core,picker-dom}/**`
      - `editors`: `apps/{vscode,jetbrains}/**`, `packages/{editor,core}/**`
      - `desktop`: `apps/desktop/**`
      - `docs`: `apps/docs/**`
      - `dotnet`: `integrations/{aspnetcore,serilog}/**`
      - `ci`: `.github/**`, which turns every other output on
- [ ] The four path-filtered E2E workflows become reusable workflows that `ci.yml` calls on `changes`; they keep
      `workflow_dispatch`.
- [ ] A `CI result` job, the one required check:

      ```yaml
      ci-result:
        name: CI result
        if: always()
        needs: [changes, checks, build, e2e, package-smoke, demo, dotnet, extension, vscode, jetbrains, desktop, docs]
        runs-on: ubuntu-latest
        timeout-minutes: 2
        steps:
          - name: Fail when a needed job failed or was cancelled
            if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')
            run: exit 1
      ```

- [ ] A docs build on pull requests that change `apps/docs/**` (about 15 seconds).
- [ ] `pr-lint.yml`: `commitlint.yml` and `pr-title.yml` as two jobs, plus `actionlint` when `.github/**` changes.
- [ ] Branch protection switched to `CI result` (and `PR lint`) the day this merges, or pull requests wait for check
      names that no longer exist.

### Phase 3: test matrices (one pull request per item; D2 and D4 decide the split)

- [ ] E2E on two backends for pull requests, `local + sqlite` (Node 22, the `engines` floor) and `s3 + postgres`, five
      shards each: 20 → 10 jobs. All four backends where D2 says, from a matrix `changes` computes (`fromJSON`).
- [ ] Extension E2E in three shards by file (`fullyParallel: false` stays) and `retries: 1` on CI, as the dashboard
      suite retries: about 16 → 7 minutes of wall-clock time. `replay.spec.ts` (5.1 minutes) bounds the longest shard;
      split it if needed.
- [ ] Desktop E2E reuses the `build-output` artifact of `ci.yml`'s `build` job: 2.3 macOS minutes less per run, and no
      `--max-old-space-size` workaround.
- [ ] JetBrains: `verify` on the oldest and newest IDE (`WS:2024.1`, `WS:2026.2.3`) for pull requests, all four where
      D4 says. The `plugin` job also runs on `main` when `changes.editors` is true, which writes the Gradle cache. The
      `verify` IDEs stay out of the cache: four distributions would take a large share of the 10 GB and evict the rest.
- [ ] `checks` in two parallel jobs (lint, typecheck and package tests; application and reporter unit tests with
      coverage): 7.3 → about 4.5 minutes. Only if `checks` becomes the longest path once the items above have landed.
- [ ] Package smoke: Linux on pull requests; Windows and macOS on `main`, or on pull requests that change
      `packages/{server,reporter}/**` or `scripts/package-smoke.mjs` (D5).

### Phase 4: releases and the `edge` image (dry-run with `workflow_dispatch` on a branch before the next tag)

- [ ] `release.yml` on `push: tags: v*` and `workflow_dispatch` (a `tag` input): one `build-server` job
      (`NITRO_PRESET=node-server`) whose artifact feeds both the npm server package and the four desktop builds, then a
      call to each `reusable-publish-*.yml` with `secrets: inherit`. Run on a branch, it builds without publishing, as
      the publish workflows do.
- [ ] `reusable-publish-npm.yml` publishes reporter, server and the Nitro instrumentation.
- [ ] The `edge` image on every push to `main` or nightly (D3).
- [ ] `CONTRIBUTING.md` (the workflows to re-run by hand) and the comment in `release-please.yml`.

### Phase 5: documentation

- [ ] `.github/AGENTS.md` with the conventions above, in the area-guide table of the root `AGENTS.md`.
- [ ] The workflow and job names quoted in `AGENTS.md` (`package-smoke`) and in the extension, VS Code, JetBrains and
      desktop guides.

## What to expect

| Measure                                    | Before   | After phases 1 to 3         |
| ------------------------------------------ | -------- | --------------------------- |
| `ci` jobs for an application pull request  | 27       | ~17                         |
| `ci` runner minutes for a pull request     | ~80      | ~50                         |
| Wall-clock time of a pull request (median) | 12.3 min | ~8 min                      |
| Runner minutes per merge to `main`         | ~210     | ~90 (D2, option A)          |
| Runner minutes over the 15-hour window     | ~4,100   | ~2,100 to 2,300             |

The "after" column is computed from the measured job durations, to be confirmed by measuring after each phase.

## Decisions

- **D1. One required check, `CI result`** (recommended). Branch protection changes the day phase 2 merges.
  Alternative: keep today's checks and gate with job-level `if` only.
- **D2. Where the four-backend matrix runs.**
  - A (recommended): pull requests on two backends, pushes to `main` on four. A regression only a crossed pair shows
    is seen right after the merge.
  - B: pull requests and `main` on two, all four nightly. Cheaper; seen up to a day later.
  - C: a merge queue (`merge_group`): the full matrix runs once on the merge result, before the merge, and `ci` on
    `main` only seeds the caches. The most thorough; it changes how pull requests are merged.
- **D3. The `edge` image**: on every push to `main` (about 7 runner minutes a merge) or nightly.
- **D4. JetBrains `verify`**: two IDEs on pull requests and four on `main` or nightly, or four on pull requests that
  change `apps/jetbrains/**` and two when only `packages/editor` or `packages/core` changes.
- **D5. Package smoke on Windows and macOS**: on every application pull request (today), or when the server or
  reporter package changes, and on `main`.

## Before phase 4

- **npm trusted publishing**: if npmjs.com trusts a workflow file for `@piwitests/reporter`, `@piwitests/server` or
  `@piwitests/instrumentation-nitro`, the file name is part of that setting, and renaming the workflow breaks the
  publish until the setting follows. The same holds for NuGet (the job asks for `id-token: write`).
- **Cache usage** (`gh cache list --sort size_in_bytes`): whether the 10 GB limit already evicts the npm and Playwright
  caches. The Nuxt build cache (`nuxt-build-v2-…-<sha>`) is about 18 MB a run.
- **The Nuxt build cache's worth**: one build with it and one without (103 seconds measured with it). If it saves
  nothing, dropping it simplifies the `build` job.
