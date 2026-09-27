Source code: the attached source archive holds the sources of this exact build. With Node.js 24 and npm, from the archive's root:

    npm ci --workspace=apps/extension --include-workspace-root
    npm run extension:build:release --workspace=apps/extension

The output in apps/extension/dist/ is identical to the uploaded add-on (diff -r). README.md at the archive's root has the details. Vite bundles and minifies the code; nothing is obfuscated and no code is loaded remotely.

Network: none by default. Picking, recording and every page tool run locally. The options page can connect the add-on to the user's own self-hosted Piwi instance (a URL and an API key the user enters). Only the options page and the background script then make requests, to that instance only: they read the project list, the URL patterns, a project's function catalog, its locator index and its bug reports, and they send one thing, a bug report, when the user clicks Send in a preview that shows exactly what is sent (the recorded steps and the evidence the user kept ticked). Nothing read from a page is sent otherwise, and content scripts never make network requests.

Permissions: activeTab, scripting and storage. The optional host permissions (http://*/*, https://*/*) grant nothing at install: the popup requests one origin when the user starts recording on that site, and the options page requests the instance's origin when the user saves a connection.

innerHTML: every assignment the linter reports inserts either static markup or locator text that the syntax highlighter has HTML-escaped (highlightLocator in packages/picker-dom/src/syntax-highlight.ts, and the overlays' own highlighter in packages/picker-dom/src/overlay-element.ts and overlay-confirm.ts).

Testing: no account is needed. Open any web page, click the toolbar button and pick a tool: Pick an element (click an element to see its ranked locators), Lint overlay, Locator console, or Record actions (allow the site, click through a few pages, then Stop to review the generated spec). What needs a Piwi instance (Test functions, Tested elements, and function matching while recording) can be skipped.
