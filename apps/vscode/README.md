# Piwi for VS Code

Your Playwright suite's history where you change the code, from a [Piwi](https://piwitests.dev) instance.

- **CI failures in the Problems panel.** The failures of the latest run on the checked-out branch, at their failing
  line, with one line on why each failed.
- **Heal in place.** On a failing locator, the replacement Piwi recommends is a quick fix: the same edit an auto-heal
  pull request makes. **Open the trace** downloads it and opens Playwright's trace viewer; the failure screenshot is in
  the hover.
- **The tests behind each line.** Beside each test, its latest result in the gutter, a failing test's body tinted, and
  its history on hover; above each locator line, the tests that use it; above an application file, the tests that
  reach it (with code reach on).
- **Brittle locators and breaking changes.** A warning on a brittle locator, with the stable alternative stored at that
  call site; a warning on the line of an unsaved change that renames a string tests find elements by, with a quick fix
  that updates every call site.
- **The status bar.** The latest run on the branch, live while it runs.
- **Piwi's MCP server for the agent**, with the connection the extension already has.

## Connect

The extension reads the connection the reporter uses: `PIWI_DASHBOARD_URL`, `PIWI_API_KEY` and `PIWI_PROJECT_NAME` in
the environment or the workspace `.env`, then the Piwi desktop app. Otherwise run **Piwi: Connect**; the API key goes
to VS Code's secret storage. When the desktop app runs beside a shared instance, **Piwi: Connect** switches between
them, and keeps both.

See [the editors page](https://piwitests.dev/features/editors) for everything it shows.
