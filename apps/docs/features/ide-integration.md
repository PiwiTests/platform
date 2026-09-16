---
title: Open in IDE
lang: en-US
---

# Open in IDE

<Needs reporter />

Every source path the dashboard shows — the failing call stack ("Failed here"), a
run's test-case list, a test case's file, flaky lists, cluster evidence, the AI
suggested-fix — is clickable. Hover a path and a small **open in IDE** control
appears: click it to jump straight to that file (and line) in your local editor,
or open the chooser to pick a specific method.

Because the dashboard runs in your browser while the source lives on your
machine, the mapping from a repo-relative path (`tests/checkout.spec.ts`) to a
real file is configured **per browser** and stored locally — it is never sent to
the server.

## Set it up

1. Hover any source path and click the **⌄** caret, then **Configure…** — or open
   it from the user menu (bottom-left) → **Open in IDE…**.
2. Set your **workspace root**: the absolute path of your local checkout, e.g.
   `/home/me/my-repo` (or `C:\Users\me\my-repo` on Windows). Repo-relative paths
   are joined onto it, which is what VS Code needs to resolve a file.
3. Pick a **method** (or leave it on **Auto**) and close the dialog. Clicking a
   path now opens it in your editor.

## Methods

| Method | How it opens | Needs |
|--------|--------------|-------|
| **VS Code** | `vscode://file/<abs-path>:<line>` URL scheme | A workspace root (for the absolute path). Flavors: VS Code, Insiders, VSCodium, Cursor. |
| **JetBrains (URL)** | `jetbrains://<product>/navigate/reference?project=<name>&path=<rel>:<line>` | [JetBrains Toolbox](https://www.jetbrains.com/toolbox-app/); the IDE product tag (e.g. `idea`, `webstorm`) and the open project name. |
| **JetBrains (local server)** | `http://localhost:63342/api/file/<path>:<line>` | The IDE running with the **[IDE Remote Control](https://plugins.jetbrains.com/plugin/19991-ide-remote-control)** plugin and **Settings → Build → Debugger → "Allow unsigned requests"** enabled. |
| **Auto** | Tries the JetBrains local server first, then falls back to a URL launch | Whatever the chosen fallback needs. |

### Auto — "try all, stop on first success"

Only the **local server** method can be confirmed from the browser: the dashboard
sends it a `fetch` and, if the IDE answers, reports success. The `vscode://` and
`jetbrains://` URL schemes are handed off to the operating system with **no
success signal** — the browser's own "Open &lt;app&gt;?" prompt is the only real
confirmation.

So **Auto** probes the JetBrains local server first (the detectable rung) and, if
nothing answers, launches a single URL scheme (VS Code when a workspace root is
set, otherwise `jetbrains://`) — reported honestly as "opening… (can't confirm)".
If you only ever use one editor, set the method explicitly to skip the probe.

::: warning HTTPS and the local server
Browsers block a page served over **HTTPS** from calling `http://localhost`
(mixed content) — Firefox and Safari always, Chrome increasingly. The local-server
method (and Auto's detectable rung) therefore works best when the dashboard is
served over **http / localhost**. Over HTTPS, Auto still falls back to the URL
schemes, which are unaffected.
:::

## Per-project overrides

If you view several projects that live in different local checkouts (or a
monorepo), open **Configure…** from a path inside that project — the dialog then
offers a **workspace root override** and a **JetBrains project name** just for
that project. Everything else falls back to your global settings.

## Privacy

All of this — the method, workspace root(s), editor flavor and JetBrains
product/port — lives in your browser's `localStorage` under `piwi-ide-prefs`.
Nothing about your local filesystem is sent to the Piwi server.
