---
title: Editor connection
description: "Connect the Piwi extension for VS Code or the JetBrains plugin to your instance: the connection the reporter already uses, a browser sign-in that creates an API key for the editor, or the desktop app running on your machine."
lang: en-US
---

# Editor connection

The [editor extensions](./editors) read everything from your Piwi instance. They find it in this order, and the first
that names an instance wins:

1. `PIWI_DASHBOARD_URL`, `PIWI_API_KEY` and `PIWI_PROJECT_NAME` in the environment the editor was started with;
2. the same variables in the `.env` next to the Playwright config, then at the repository root (a URL there takes only
   its own key);
3. the instance saved with **Piwi: Connect**;
4. the [desktop app](/features/desktop), while it runs.

A project set up for the reporter needs nothing more. An editor started from the Dock or the Start menu may not see
the variables your shell exports: the `.env` or Connect work either way.

## With the desktop app

The desktop app needs no pairing with the editor: while it runs, it publishes its address and a local token in
`~/.piwi/desktop.json`, which the editor reads, as the reporter does. The editor notices within seconds when the app
starts or quits.

The project is the one whose **linked folder** holds the workspace's Playwright config: link the folder on the
project's page in the desktop app, and the editor opens on that project. Without a link, pick the project with
**Piwi: Connect**, or set `PIWI_PROJECT_NAME`.

An instance saved with Connect comes before the desktop app: to use the app again, run **Piwi: Connect** and choose
**Use the Piwi desktop app**, or **Piwi: Disconnect**.

## Connect

Run **Piwi: Connect** from the command palette, or click **Piwi: connect** in the status bar. In a JetBrains IDE it is
the **Connect…** button of **Settings → Tools → Piwi**, in the **Piwi** tool window's toolbar, and under
**Tools → Piwi**.

1. When the desktop app runs, Connect offers it first: choose **Use the Piwi desktop app**, and pick the project if
   none is linked to the folder. Otherwise, or with **Another instance**, give the instance's address, such as
   `https://piwi.example.com`.
2. When the instance has a login, choose **Sign in with the browser**. The instance's page opens with a code: check
   that the editor shows the same code, then click **Allow**. The editor receives an [API key](/operate/api-keys)
   created for you and named after it, such as "Piwi in WebStorm on macOS", which you can revoke with your other keys.
   Or paste a key you created yourself. An instance without a login needs no key.
3. Pick the project.

When the environment or a `.env` names another instance, Connect saves your choice and says which source comes first.

## What is saved where

| | VS Code | JetBrains IDEs |
|---|---|---|
| Address and project | `piwi.serverUrl` and `piwi.project` in the workspace settings | `.idea/piwi.xml` |
| With the desktop app | The project only, when none is linked to the folder | The project only |
| API key | The editor's secret storage | The IDE's password safe |

The address and the project can be shared with the team. The key never goes to a file, and is saved for its instance
only: a repository whose settings name another instance never receives it. **Piwi: Disconnect** (the **Disconnect**
button in a JetBrains IDE) forgets the address, the project and that instance's key.

## Which connection is in use

The status bar's tooltip names the instance and where it came from. In a JetBrains IDE, **Settings → Tools → Piwi**
and the **Piwi** tool window say the same, or why the editor is not connected. The plugin starts its service when you
open a file of a project that holds a Playwright config; until then, both say so.

**Piwi: Open settings** in VS Code opens the extension's settings.
