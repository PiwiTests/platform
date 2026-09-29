# Live E2E tests

These specs talk to **real** external services, so they are excluded from the main Playwright suite
(`playwright.config.ts` ignores `tests/live/`), each carry their own config, and run only on demand. They cost tokens
or write to a real account — never wire them into `push`/`pull_request` CI.

## AI diagnosis — `ai-diagnosis-live.spec.ts`

The real two-stage diagnosis pipeline against a real model.

```bash
OPENCODE_API_KEY=<key> npm run app:test:ai:live
```

Uses its own port and a throwaway SQLite DB under `.live-temp/diagnosis/`.

## Jira Cloud — `jira-live.spec.ts`

The real Jira integration against a Jira Cloud site. It files a **French** issue, reads it back through the Jira REST
API (asserting the French headings, the `piwi` labels and the `Piwi-Cluster:` trailer), exercises a policy comment and
**one transition** through the milestone-3 sync policies, and then **deletes every issue it created** plus any stray
issue carrying the `piwi-live-test` label — so a free-plan site never fills up. Every issue it files carries
`piwi-live-test`.

```bash
PIWI_JIRA_BASE_URL=https://your-team.atlassian.net \
PIWI_JIRA_EMAIL=you@example.com \
PIWI_JIRA_API_TOKEN=<token> \
PIWI_LIVE_JIRA_PROJECT_KEY=PIWI \
npm run app:test:jira:live
```

- The config throws a clear error at load if any of the four variables is unset.
- It boots the server with the env-managed Jira connection (from `PIWI_JIRA_*`) and its own port + `.live-temp/jira/`
  DB, so it never touches a real dashboard database.
- Issue types, priorities and transitions are addressed **by id**, so a French-configured site (French issue-type and
  status names) works unchanged — that is part of what this test proves.
- A classic or a scoped token works. The spec's own read-back and cleanup calls route a scoped token through the
  `api.atlassian.com` gateway, as the server does. The token's account needs the **Delete Issues** project permission
  on top of the ones the integration needs, or the cleanup leaves the issue behind (the run logs a warning).
- The GitHub Actions workflow `.github/workflows/live-jira.yml` runs it on `workflow_dispatch`, mapping the four
  repository secrets of the same names into the job.

> **Never commit credentials.** `.env*` is gitignored; pass the values through the environment.
