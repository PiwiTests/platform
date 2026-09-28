---
title: Extension connection
description: "Connect Piwi Picker to your Piwi instance in one step, and keep the URL patterns that tell it which project a page belongs to on the instance, shared by your team."
lang: en-US
---

# Extension connection

<Needs extension />

[Piwi Picker](./extension) works on its own. Connected to your Piwi instance, it also matches a recording against
your project's [test functions](./test-functions) and shows [Tested elements](./tested-elements). Connecting takes
one click, and the URL patterns that say which project a page belongs to live on the instance, so a team sets them
once.

## Connect in one step

1. Open Piwi Picker's settings (the gear button in its popup) and type your instance's address.
2. Click **Connect**. The browser asks to let Piwi Picker reach that one address; allow it.
3. A tab opens on your instance. Sign in if asked, with a password or your usual sign-in provider: you come back to
   the same page. It names the connecting browser ("Piwi Picker in Chrome on Windows") and shows a code.
4. Check that the settings page shows the same code, then click **Allow**.

The tab closes, the settings say **Connected as** your name, and the instance's URL patterns appear under **From
your Piwi instance**.

Allowing creates an API key for your account, named after the browser, with your role and project access. It is
listed with your other keys in your account's API key settings, where you revoke it; the browser is then
disconnected at its next request. **Deny**, or ten minutes without an answer, creates nothing.

With [authentication](/operate/authentication) off, **Allow** only confirms the connection: there is no account to
own a key, and none is needed.

### Use an API key instead

Under **Use an API key instead**, paste a key created in your account's [API key settings](/operate/api-keys) and
click **Test connection**, then **Save**. An instance older than the one-step connection needs this. So does the
desktop app, whose server answers only requests carrying its access token.

## URL patterns

A URL pattern is a glob over a page's whole address: `*` matches within one part of the path, `**` across parts. So
`https://staging.shop.example/**` covers every page of that site, and `https://shop.example/admin/*` the pages one
level under `/admin`. A pattern starts with `http://`, `https://` or a wildcard.

Each project keeps its own list in its **Settings** tab, under **Browser extension URLs**. A pattern can name:

- an **environment**, a label shown beside the project in Piwi Picker (`staging`, `production`);
- a **branch**, the one deployed at those addresses, whose tests [Tested elements](./tested-elements) shows.

The editor suggests one pattern per site your suite already visited: the `baseURL` of recent runs, the pages of the
[Test Map](./scenario-gaps) and the absolute pages its locators ran on. **Add** puts a suggestion in the list; **Save
patterns** stores it. Editing the list takes the administrator role, like the rest of the project's settings.

### Which project applies

Piwi Picker reads the patterns of every project you can see when it connects and each time its settings open, and
keeps a copy, so a page's project is known with the instance out of reach. For a page it decides in this order:

1. the project chosen in the popup's **Active project**, for the rest of the browser session;
2. the patterns under **This browser only**, the first that matches;
3. the instance's patterns, by project, in each project's order, the first that matches.

A pattern kept in the browser is therefore an override for that browser alone. The settings page marks each pattern
with where it comes from.

### Add a site

When the current tab matches no pattern, the popup says so and offers **Add this site**. It opens the settings with
`https://<site>/**` filled in: choose a project and click **Add to Piwi**, or **Keep in this browser only**. Adding to
the instance takes a role that edits the project; without one, the settings say so and keep the second choice.

## What is sent

Connecting sends the browser's and the operating system's names, nothing else about the machine. Afterwards the
extension downloads the URL patterns, each mapped project's function catalog and its locator index; adding a site
sends that one pattern. A recording is never sent to the instance: **Send to editor** sends it only to an editor paired
on the same computer. Only the settings page and the extension's background worker talk to the instance or the
editor, never a script running in a page.

## Related

- [Browser extension](./extension): everything Piwi Picker does, with or without a connection
- [API keys](/operate/api-keys): create, list and revoke keys, those Piwi Picker created included
- [Tested elements](./tested-elements): what a connection shows on the page
- [Project access](/operate/project-access): which projects, and so which patterns, a user sees
