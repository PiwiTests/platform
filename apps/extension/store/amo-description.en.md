Piwi Picker finds the locator to use for any element of the page you are on. Every candidate is ranked by how stable it is, then counted against the live page, so the one at the top matches exactly one element. It also turns a flow you click through, across several pages, into a runnable Playwright spec.

**Tools, all on the live page**

- **Pick an element**: the ranked locators of one element, re-checked against the page, copied as a locator, an action line or an assertion.
- **Hover-inspect**: the best locator of whatever the pointer is on.
- **Locator console**: type a locator and see what it matches right now, with a strict-mode verdict.
- **Multi-pick**: the pattern shared by a list's rows or cards.
- **Lint overlay**: the elements that would make bad locator targets, each with a suggested data-testid.
- **Assertions**: expect(...) lines for an element.
- **Session**: elements you name across pages, exported as a page object, a Markdown table or JSON.
- **Agent context**: one block describing an element, for a coding agent.
- **Record actions**: clicks, fills and selections across a site's pages, turned into a TypeScript spec. Password values are never captured.

**Private by default**

Picking and recording never use the network. Nothing is collected or sent anywhere.

**Optional: connect your own Piwi instance**

Piwi is a self-hosted dashboard for Playwright test results. Connecting the add-on to your instance (its URL and an API key, in the settings) adds three tools: recordings that call your own test functions, a check of which functions work on the page, and an outline of the elements your tests reach. The add-on only reads from your instance; a recording is never sent to it.

**Permissions**

- The tab you are looking at, only when you click the toolbar button or press the shortcut.
- One site, asked for when you start recording on it, so the recorder can follow you across its pages. Nothing is granted at install.
- Your Piwi instance's address, asked for when you save a connection.

Documentation: [piwitests.dev/features/extension](https://piwitests.dev/features/extension)

Piwi is not affiliated with, endorsed by, or connected to Microsoft Corporation. Playwright is a trademark of Microsoft Corporation.
