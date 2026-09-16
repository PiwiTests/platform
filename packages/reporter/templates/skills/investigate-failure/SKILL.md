---
name: investigate-failure
description: Investigate a failed test run recorded in Piwi Dashboard and propose a fix grounded in its evidence — error, steps, console, network, locator suggestion, and the diff since the last green run. Use when the user asks "why did the last run fail", "what broke in CI", "diagnose this failure", or points at a Piwi run/cluster.
---

# Investigate a Piwi failure

Turn a failed run in [Piwi Dashboard](https://piwitests.dev) into a grounded diagnosis and a concrete fix. Piwi has already gathered the evidence — the error text, the steps that ran, console output, failing network calls, a suggested locator, and the source diff since the last passing run. Use that instead of guessing.

## How you reach Piwi

Prefer the **Piwi MCP server** if it is connected to this agent (tools named `list_recent_activity`, `get_run`, `explain_failure`, `get_cluster_context`, …). If it is not connected, tell the user they can connect it (the reporter CLI does not proxy MCP — see the dashboard's **MCP server** page) or paste the run URL / failure details, and work from those plus the repo.

## Steps

1. **Find the run.** If the user gave a run URL or id, use it. Otherwise call `list_recent_activity` (or `list_runs` for a specific project) and take the most recent failed run. Confirm with the user if several projects are in play.

2. **Get the failures.** Call `get_run` with a failed-status filter to list the failing cases. For a fast single-call evidence bundle on one case, use `explain_failure` (error + steps + console + locator fix + diagnosis context).

3. **Group by cause.** Call `get_failure_groups` (or `list_clusters` / `get_cluster`) — failures that share a root cause are clustered, so you fix one thing, not five. Work cluster by cluster.

4. **Read the evidence per cluster.** Call `get_cluster_context` — the same SCM-grounded context the built-in diagnosis uses: representative errors, test steps, console logs, failing network requests, ARIA snapshots, and the **diff of files changed since the last green run**. If a diagnosis already exists, `get_cluster_diagnosis` returns its root cause and suggested fix.

5. **Form the diagnosis.** Tie the failure to a cause with evidence: a selector that stopped matching, an assertion on changed copy, a slow/500 endpoint (`get_network_requests`), a race, a genuinely flaky test (check `get_test_stability_trend` — if it fails intermittently, treat it as flaky, not a regression). Point at the specific commit/file from the diff when the evidence supports it.

6. **Propose the fix.** Make the smallest change that addresses the root cause, in the actual source or spec files. Prefer Piwi's own suggestions where they exist — for a broken selector, the ranked replacement from `get_locator_healing` (the `apply-locator-healing` skill does exactly this). Show the diff.

7. **Verify.** Re-run the affected spec(s): `npx playwright test <file>`. Confirm they pass and the new run is green in the dashboard (`get_run_insights` compares against the last green run: regressions cleared, nothing new broken).

8. **Close the loop (optional).** With packages/reporter/admin access, `set_cluster_status` marks the cluster resolved with a note so it drops off the triage queue.

## Guardrails

- Ground every claim in evidence you actually read — never invent a stack trace, a commit, or a line number. If the evidence is thin, say so and get the trace (`list_case_traces`) or ask.
- Distinguish a **regression** (was passing, now failing — fix the cause) from a **flaky** test (intermittent — stabilize it) from an **environmental** failure (dashboard/CI/network). The fix differs for each.
- Don't mark a cluster resolved until a run proves it. Report the diagnosis, the change, and the verifying run URL.
