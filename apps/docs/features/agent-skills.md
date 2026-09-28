---
title: Agent skills
description: "Six SKILL.md files, installed by the reporter's CLI, that teach a coding agent what to do with Piwi's evidence: investigate a failure, heal a locator, fix a flaky test, write the missing one."
lang: en-US
---

# Agent skills

<Needs reporter />

The [MCP server](/features/mcp) gives an agent read access to your results; **skills** tell it what to *do* with them.
A skill is a single `SKILL.md` file, the portable open format (front matter plus Markdown instructions) that Claude
Code and other coding agents read from a project's skills directory. Piwi ships six, and the reporter's CLI installs
them into your test project.

## What each skill does

| Skill | What it does |
|------|--------------|
| `setup-piwi` | Wire a Playwright project up to a dashboard: the same work `npx @piwitests/reporter init` does, driven by an agent. |
| `investigate-failure` | Investigate a failed run and propose a fix grounded in Piwi's evidence: error, steps, console, network, and the diff since the last green run. |
| `apply-locator-healing` | Replace a brittle locator with Piwi's ranked [healed locator](/features/locator-healing) at its call site, then re-run to confirm. |
| `stabilize-flaky-tests` | Fix the root cause of the highest-impact [flaky tests](/features/flaky-tests) (never by adding retries), then verify with repeated runs. |
| `run-the-right-tests` | After a UI change, fix the locators it breaks with [preflight](/features/preflight); then pick and run the right [selection](/features/test-selection) for the task (smoke, recently broken, a time budget) instead of the whole suite. |
| `write-the-missing-test` | Take the top [scenario gap](/features/scenario-gaps) in scope, draft it from the graph, finish the assertion and add it in the same change. |
| `fix-a-reported-bug` | Take a [bug report](/features/bug-reports), write its failing test with `piwi bug <id> --write`, reproduce, fix, then remove `test.fail()` and run the spec and the tests that visit the page. |

Each skill prefers a connected Piwi [MCP tool](/reference/mcp-tools) and falls back to the dashboard UI when MCP is
not connected, so a skill works before the MCP server is set up, only more slowly.

## Where it is

The skills ship inside the reporter package. `npx @piwitests/reporter init` installs the five workflow skills as part
of setup (everything but `setup-piwi`, which an agent runs before the reporter exists). The **MCP server** page of the
dashboard (`/mcp`) lists them next to the tools.

## Use it

```bash
npx @piwitests/reporter skills add          # install all six into .claude/skills/
npx @piwitests/reporter skills list         # see what each one does
npx @piwitests/reporter skills add investigate-failure --dir .cursor/skills   # one skill, elsewhere
```

Invoke the CLI through the package name so npx resolves this package; a plain `npx piwi …` works once the reporter
is a project dependency. `init` takes `--skills <list>` (or `all`, `none`), `--skills-dir` and `--no-skills` to
change what setup installs. The [CLI reference](/reference/cli#skills) lists every flag.

The skills are agent-agnostic Markdown: only the destination is tool-specific, so `--dir` points the install wherever
your agent reads skills from. An existing file is left alone unless you pass `--force`, so a skill you edited stays
yours.

Once installed, ask in plain words: "why did the last CI run fail", "fix the flaky checkout test", "write the test
we're missing for this change". The agent picks the skill whose description matches.

## Prompts, the no-install alternative

The MCP server also offers a `setup_piwi` **prompt**, which a client shows as a slash command with nothing to
install. It knows this instance's URL, whether it requires an API key and its existing projects, which a static skill
cannot. The prompt needs MCP; the `setup-piwi` skill works offline. See [MCP server](/features/mcp#prompts).

## Limits

- **Instructions, not code.** A skill tells an agent which evidence to read and in which order; the agent still
  writes the fix, and you review it.
- **Updated with the reporter.** A newer reporter ships newer skills; run `skills add --force` to replace the
  installed copies, which overwrites any edits.

## Related

- [MCP server](/features/mcp): the tools the skills call
- [MCP tools](/reference/mcp-tools): every tool, by module
- [Piwi CLI: skills](/reference/cli#skills): every flag of `skills` and `init`
