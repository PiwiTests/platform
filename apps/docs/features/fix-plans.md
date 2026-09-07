---
title: Fix plans, reproduce & bisect
lang: en-US
---

# Fix plans, reproduce & bisect

<Needs reporter desktop />

A **fix plan** gathers everything Piwi knows about a failure cluster into one answer to "what do I do about this?" — the [AI diagnosis](./ai-diagnosis) and its validated patch, the ranked [locator replacement](./ai-diagnosis#locator-healing) with the exact file and line to edit, the failing tests, the owning team, and the command that verifies the work. None of it needs a model of its own: a cluster with no AI diagnosis still returns its failing tests, its locator suggestions and its verification command, so the plan is useful with no AI provider configured at all.

## Where to get it

The same plan is reachable three ways:

- **On the cluster page** — the recommended action leads the page as the **Next** line, the failing tests are the **Affected tests** selector, and the owner is on the identity line. Everything else lives in [**More ways to fix**](#more-ways-to-fix), the folded toolbox below the evidence: the diagnosis and its patch, the locator fix, the verify command, the reproduce recipe, and a **Copy as Markdown** action for a ticket.
- **As Markdown** — `GET /api/failure-clusters/:id/fix-plan?format=markdown` returns the same rendering as plain text, so an export or a script can drop it straight into an issue.
- **For agents** — the `get_fix_plan` [MCP tool](/features/mcp) returns the structured plan, so a coding agent gets in one call what a person reads on the card.

The last part is what makes it a loop rather than a lookup: the plan states which Playwright command runs exactly the affected tests, and that Piwi will record the fix once they pass — so an agent (or a person) can confirm the work instead of leaving someone to decide whether it landed. Nothing leaves your machine: the dashboard is yours, the model is whichever one you configured (including a local one), and the patch was validated against your own source before you saw it.

## More ways to fix

The cluster and [execution](./evidence#one-execution-diagnosis-first) pages end in one **More ways to fix** toolbox — the block that replaced the old Fix card. Each way to fix, verify or reproduce is a section folded to one line (a label and a summary from the page's own data), so no code block opens by default. The section the **Next** step points at opens with the page — a diagnosed fix opens **Diagnosis**, a locator failure opens **Locator fix** — and you unfold the rest as needed.

## Reproduce and bisect

The fix plan also hands back the two things you do next: a copy-paste recipe that reproduces the failure locally, and a generated `git bisect` that finds the commit that broke it. Both sit in the toolbox's **Reproduce and bisect** section, and travel with the plan through `?format=markdown` and the `get_fix_plan` MCP tool. The exact test command leads; **Show the full recipe ▸** unfolds the checkout, install and bisect.

The **recipe** is the local reproduction, in order: check out the commit the run failed on (`git switch --detach <sha>`), install dependencies, pin Playwright to the version the run used, install the browser it ran on, and run exactly the failing test. Each part degrades on its own — no recorded commit skips the checkout and says so, an unknown Playwright version drops the pin — and the run's environment (label, base URL) is listed beside it. Every command is `git`, `npm` or `npx`, so it is identical on Linux, macOS and Windows; the dashboard still offers a **Linux / macOS** and a **Windows (PowerShell)** tab so a reader copies the form they expect.

```bash
# Check out the failing commit
git switch --detach 9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d
# Install dependencies
npm ci
# Pin Playwright to the run's version
npm install -D @playwright/test@1.52.0
# Install the browser
npx playwright install chromium
# Run the failing test
npx playwright test "tests/admin/users.spec.ts" --project="Chromium"
```

The **bisect** walks the commits between the last green run and the failing one, re-running the test at each step — a non-zero exit marks a commit bad — until it names the first commit that broke it, then `git bisect reset` returns you to where you started.

```bash
git bisect start <failing-commit> <last-green-commit>
git bisect run npx playwright test "tests/admin/users.spec.ts" -g "Users table paginates 25 rows per page"
git bisect reset
```

The bisect needs a **last-green commit** and an **SCM connection**: when Piwi has no commit for the failing run or for the last green run before it, or the two are the same commit, the section says so in one line instead of showing a script. The recipe is always there.

In the [desktop app](/features/desktop#reproducing-a-failure-and-finding-the-breaking-commit) the same section can also do the work for you: **Reproduce here** runs the recipe against the linked folder in a throwaway `git worktree` — your checkout is never touched — and **Find the breaking commit here** drives the whole bisect step by step, with live progress and a stop that stops, then records the first bad commit on the cluster so it shows here and in the fix plan afterwards.

## Fixed before

An open cluster often isn't new — the same failure, or one close to it, was fixed weeks ago. The fix plan looks back over the project's **resolved** clusters (resolved, or with a verified fix that held) and, when one resembles the open cluster closely enough, shows it in the **Fixed before** section of the toolbox — on the cluster page and on the failing execution's page, and in the `?format=markdown` export and the `get_fix_plan` MCP tool.

A match is scored deterministically first — the same fingerprint family (error kind, masked message, masked locator), the same failing locator, the same spec file or test — and then, when an [embedding model](./ai-diagnosis#model-roles) is configured, by semantic similarity of the stored cluster vectors. The top three matches are shown, each with **when** it was resolved, the **commit** that fixed it (linked when the repository host is known), **how long** it stayed open, the triage note, the owner, the earlier diagnosis and its thumbs feedback, and one short reason it matched ("same error and locator", "same spec, similar message (0.91)"). Nothing matches → the section renders nothing, no empty-state noise.

**Apply the same triage** copies the earlier cluster's triage note onto the open one, prefixed `Same as cluster #N:` so the history reads as an intentional reuse. It never changes the open cluster's status — a new cluster is never marked resolved just because an old one was. The same top match is fed to the AI diagnosis as a *Previously fixed similar failure* clue, so the model can reuse a known fix rather than re-derive it.

## Related

- [AI diagnosis & failure clustering](./ai-diagnosis) — the diagnosis and validated patch a fix plan wraps
- [Failure clusters & the inbox](./failure-clusters) — the clusters a fix plan is attached to
- [Auto-heal PRs](./auto-heal) — when Piwi opens the locator fix as a pull request itself
- [MCP server](/features/mcp) — the `get_fix_plan` tool
- [Desktop app](/features/desktop#reproducing-a-failure-and-finding-the-breaking-commit) — run the recipe and drive the bisect locally
