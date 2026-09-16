---
title: Recipes
lang: en-US
---

# Recipes

The rest of this site is organized by feature — what clustering is, what the flaky score means. These
pages are organized the other way round: by the question you actually arrived with, on the morning it
matters.

| You're asking | Recipe |
|---|---|
| "This test went red — did I break it, or is it just flaky?" | [Regression or flake?](./regression-or-flaky) |
| "The selector worked yesterday and the UI moved." | [Fix a broken locator](./broken-locator) |
| "Forty tests are red and I don't know where to start." | [Triage a run that went mostly red](./mass-failure) |
| "Our suite is unreliable and I have one afternoon." | [Cut the flakiness that costs the most](./flaky-cleanup) |
| "CI takes forever and I don't know what's slow." | [Cut the time the suite costs](./faster-suite) |

Every recipe assumes the [reporter](/guide/reporter) is installed and has sent a few runs — that's the only
hard requirement. Where a step needs more than that (the capture fixtures, an LLM key, a browser
extension), it says so and gives you a route that doesn't.

## The tools each recipe draws on

Piwi has more surfaces than any one team will use. Nothing below is required; the table is here so you
know what exists and what it costs to switch on.

| Surface | What it's for | What it needs |
|---|---|---|
| **Dashboard** | Everything, by hand | The server. Always available. |
| **[Capture fixtures](/guide/capture-fixtures)** | Locator healing, network timing, Web Vitals, console, ARIA snapshots | One file in your test setup, imported by your specs |
| **[MCP server](/features/mcp)** | Asking your coding agent instead of clicking | Nothing — it's built into the server at `/mcp` |
| **REST API** | Scripts, dashboards of your own, CI steps | Nothing; see the [API docs](https://piwitests.dev/demo/docs) |
| **[AI diagnosis](/features/ai-diagnosis)** | An explanation of a cluster read against your git diff | An LLM you configure. Off by default; a local model works |
| **[Open in IDE](/features/ide-integration)** | Jumping from a stack frame to the file | Per-browser config, no install |
| **[Browser extension](/features/extension)** | Picking a locator against the live page | A one-click install from the [Chrome Web Store](https://chromewebstore.google.com/detail/piwi-picker/pakhnokpjboejcghgcmkjlpnogfjihhe) (Edge included) |
| **[Desktop app](/features/desktop)** | Running all of this without Docker | Windows x64 or Apple-silicon macOS; installers aren't signed yet |
| **[Notifications](/features/notifications)** | Being told instead of looking | An email, Slack, or webhook target |

If you only ever add one thing beyond the reporter, add the [capture fixtures](/guide/capture-fixtures) —
two of the five recipes above get materially better with them, and they're a single file.
