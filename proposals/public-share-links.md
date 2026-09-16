# Public share links

A design record for read-only share links: handing one investigation to someone without a dashboard account, as a
URL instead of a file. The feature shipped behind the default-off `PIWI_SHARE_LINKS_ENABLED` flag; this document
remains the reference for its decisions, alternatives and open questions. One deliberate simplification against the
original proposal is called out inline: the anonymous surface is a single server-rendered route rather than a Vue
page plus separate bundle/asset APIs.

**Summary.** A share link is an unguessable capability token (`psl_` + 64 hex chars, 256-bit) stored only as a SHA-256
hash in a new `share_links` table, scoped to exactly one entity: one execution or one failure cluster — the same two
entities offline export covers. Two anonymous GET routes resolve a token to the same `ExportBundle` the export
pipeline already collects, so the shared view shows exactly what the dashboard shows, live at view time, bounded by
the existing export size budget. Links are minted, listed and revoked through authenticated project-scoped endpoints.
The whole feature is off by default behind `PIWI_SHARE_LINKS_ENABLED`.

## Problem

Offline export (shipped — see the "Recently shipped" entry in [ROADMAP.md](../ROADMAP.md) and
`apps/docs/offline-export.md`) hands an investigation over as a self-contained file: HTML, ZIP, PDF, Markdown or JSON.
That is the right answer when the recipient must read it with no network, or when the report must outlive the
retention window. It is the wrong shape for "look at this now": the file is frozen at export time, so a diagnosis
added an hour later, a cluster marked fixed, or a new occurrence never reaches the recipient; and a 100 MB ZIP is a
heavy way to show a colleague one failing test.

A read-only link is the live counterpart: the recipient opens a URL and sees the current state of the investigation,
with the evidence, without an account. Piwi has no share-token infrastructure today — its existing credentials
(session cookie and API key in `apps/application/server/utils/auth.ts`, stream tokens, the emailed account tokens,
the desktop access token) all authenticate a known user or a machine flow, none an anonymous viewer.

## Scope (v1)

A share link covers exactly the two entities offline export covers:

- **One execution** — a `test_runs_cases` row, what `/test-run-cases/:id` shows (the vocabulary is
  `apps/docs/concepts.md`: an execution is one attempt of one test in one run).
- **One failure cluster** — what `/failure-clusters/:id` shows, including the member executions' evidence up to the
  export case cap.

The link renders a read-only view of what the corresponding detail page shows, resolved **live at view time** — not a
frozen snapshot. If the cluster gains occurrences or a diagnosis after the link was minted, the viewer sees them. If
retention prunes the underlying data, the viewer sees less (see "Retention interplay" below).

### Non-goals (v1)

- **Whole-run links.** Run-level offline export is itself still under Exploring in ROADMAP.md; share links for runs
  follow the same shape once that ships. Listed under open questions.
- **Editing or triage via link.** A link viewer can never change cluster status, save a locator pick, or trigger a
  diagnosis. The anonymous surface is strictly GET.
- **Password-protected links.** The token is the secret; a second secret on top adds UX cost without changing the
  threat model (both travel over the same channel).
- **Per-viewer identity.** No "shared with alice@" — one link, anyone holding it. `view_count` and `last_viewed_at`
  give coarse usage signal without identifying viewers.
- **Embedding/iframes.** The share page is a standalone document; nothing in v1 relaxes framing protections for it.
- **Any hosted relay service.** A project-run redirector or link gallery would mean investigation data leaving
  the operator's server, which contradicts how the project describes itself everywhere: "Self-hosted, MIT, zero
  telemetry" (README.md), and ROADMAP.md's non-goal "A hosted SaaS — Piwi is built to be self-hosted; your data stays
  yours." A share link is served by *your* instance, at *your* origin, and dies when you revoke it or shut the server
  down.

## Reuse over new machinery

The core argument of this design: the share endpoint serves **the same bundle the offline export already collects**,
rather than a new "share view" data path.

`apps/application/shared/export/collect.ts` assembles an `ExportBundle` from the handlers that already back the detail
pages — its header comment states the invariant this feature inherits: "an export shows exactly what the dashboard
shows". `collectExecutionBundle(db, executionId, opts)` and `collectClusterBundle(db, clusterId, opts)` are exactly
the two entry points the share resolver needs, one per `entity_kind`. Because the share view renders from that bundle,
it can never drift from the dashboard: any field added to the detail pages flows into exports and share views through
one collector.

Reuse also answers the resource question. The export size budget (`apps/application/shared/export/limits.ts`,
enforced through `resolveExportBudget()` / `resolveExportMaxCases()` in
`apps/application/server/utils/export-assets.ts`, tunable via `PIWI_EXPORT_MAX_INLINE_BYTES`, `PIWI_EXPORT_MAX_BYTES`
and `PIWI_EXPORT_MAX_CASES`) already bounds what one export costs the server. The share routes sit behind the same
bounds, so one anonymous request can never cost more than one authenticated export does today.

Evidence bytes go through the same plumbing: the `ExportAssetReader` interface
(`apps/application/shared/export/types.ts`) and its server implementation `serverAssetReader`
(`apps/application/server/utils/export-assets.ts`), which keeps the same path-traversal guard the file endpoint
applies (rejecting `..` and absolute paths).

## Token model

### Table

A new `share_links` table, added to **both** `apps/application/server/database/schema.sqlite.ts` and
`schema.pg.ts`, with migrations generated by `npm run db:generate` and `npm run db:generate:pg` — never hand-written,
per the rule in [apps/application/AGENTS.md](../apps/application/AGENTS.md) (a hand-made migration is silently skipped
by the migrator).

| Column | Type / constraint | Notes |
|---|---|---|
| `id` | PK, autoincrement | |
| `token_hash` | text, unique index | Unsalted SHA-256 hex of the full token, including the `psl_` prefix |
| `token_prefix` | text | First 8 hex chars after `psl_`; display-only, like `api_keys.key_prefix` |
| `project_id` | FK → `projects`, ON DELETE CASCADE, indexed | Deleting a project takes its links with it |
| `entity_kind` | text: `'execution'` \| `'cluster'` | Same union as `ExportKind` in `shared/export/types.ts` |
| `entity_id` | integer | `test_runs_cases.id` or `failure_clusters.id`; no FK (polymorphic — see retention) |
| `created_by` | FK → `users`, ON DELETE SET NULL | Survives its creator, like `project_assignments.created_by` |
| `created_at` | timestamp | |
| `expires_at` | timestamp, nullable | Null = no expiry (same convention as `api_keys.expires_at`) |
| `revoked_at` | timestamp, nullable | Set on revoke; the row is kept for the audit trail |
| `last_viewed_at` | timestamp, nullable | Updated on successful resolve, throttled like `api_keys.last_used_at` |
| `view_count` | integer, default 0 | Coarse usage signal |

Storing the hash unsalted is deliberate and matches existing practice for high-entropy secrets:
`account_tokens.token_hash` is "SHA-256 of the emailed token" (`apps/application/server/utils/account-tokens.ts`,
`hashToken`), and `api_keys.key_hash` is a SHA-256 of the full key (`generateApiKey` in
`apps/application/server/utils/auth.ts`). Salting and slow hashing defend low-entropy secrets (passwords) against
offline brute force; a 256-bit random token cannot be brute-forced regardless, and the plain hash is what makes an
indexed equality lookup possible.

### Token format

`psl_` + 64 lowercase hex chars from `randomBytes(32)` — 256 bits of entropy, the same generator and size as API keys
and account tokens. The `pd_` prefix is taken: API keys use it (`API_KEY_PREFIX` in `server/utils/auth.ts`) and the
desktop access token is deliberately `pd_`-prefixed so the reporter's API-key path can carry it
(`apps/application/server/middleware/desktop-guard.ts`). A distinct prefix keeps share tokens visually and
programmatically distinguishable — a `psl_` value pasted into an API-key field can be rejected with a useful message.

The full token is shown **once**, at creation, and never again — the same UX contract as API keys ("shown ONCE to the
user" in `generateApiKey`). Afterwards the UI shows only `token_prefix`.

## URL shape and routes

### Public (anonymous) surface — one GET route

**As implemented**, the anonymous surface collapsed to a single route: **`GET /share/<token>`**
(`server/routes/share/[token].get.ts`, outside `/api`) resolves the token and serves the offline export's
self-contained HTML rendering of the live bundle, inline. Evidence is embedded as `data:` URIs under the export
budget by the same `buildExport` pipeline the download uses, so no separate bundle or asset endpoints exist — there
is nothing else an anonymous request can reach, the Vue app is never involved (no auth-middleware change), and the
document ships with `X-Content-Type-Options: nosniff` plus the print export's `sandbox allow-scripts allow-modals`
CSP: a unique opaque origin that cannot read cookies or make credentialed calls back into the dashboard. The
original two-API shape (bundle JSON + per-asset route) remains the natural extension if a richer interactive share
page is ever wanted.

### Management surface (authenticated)

- `POST /api/test-run-cases/[id]/share-links` and `POST /api/failure-clusters/[id]/share-links` — mint a link for the
  entity; body carries the requested expiry. Returns the full token once.
- `GET` on the same two paths — list the entity's links (prefix, creator, expiry, revoked state, view count).
- `DELETE /api/share-links/[id]` — revoke (sets `revoked_at`).
- `GET /api/projects/[id]/share-links` — every link in the project, for the admin view in project settings.

All management routes authorize exactly like the neighboring entity routes: `requireResolvedProjectAccess` with
`resolveTestRunCaseProjectId` / `resolveClusterProjectId` (`apps/application/server/utils/project-access.ts`), which
resolves the entity's project, 404s a missing entity, then combines role and project scope. Per the route-meta rule in
[apps/application/AGENTS.md](../apps/application/AGENTS.md), each handler declares its roles once in
`defineRouteMeta` `openAPI['x-required-roles']`: mint and revoke declare `['administrator', 'reporter']` (the same
elevated pair as triage endpoints like `failure-clusters/[id]/status.patch.ts` — creating anonymous surface is a
write-grade action), listing declares all three roles. The two public routes declare `security: []` in their
OpenAPI meta — the documented convention for public endpoints, as `auth/login.post.ts` does — and an empty role
list like the stream-token-authenticated streaming endpoints (`test-runs/[id]/events.post.ts`), so `/docs` renders
them as token-authenticated rather than role-gated.

## Token validation

Resolution is: SHA-256 the presented token, then an indexed equality lookup on `token_hash`. The database compares
hashes, not secrets, so there is no timing oracle over token bytes to begin with — the same reasoning
`timingSafeEqualStr` (`apps/application/server/utils/timing-safe.ts`) documents for direct secret comparisons applies,
without needing that helper here.

A resolved row is live only if `revoked_at` is null, `expires_at` is null or in the future, the feature gate is on,
and the referenced entity still exists. Invalid, revoked, expired and entity-pruned tokens all return the same 404
response, with no distinguishable body or timing — with one deliberate exception: a token that **did** match its hash
but is revoked or expired may render "this link is no longer available" instead of a bare 404. A matched hash proves
the holder once had the real link, so the friendlier message has no enumeration value, and it saves the recipient of a
stale link from concluding the server is broken.

The public lookup gets a per-IP rate limit through the existing in-memory helper
(`apps/application/server/utils/rate-limit.ts` — the same one the login, setup and forgot-password endpoints use).
This is defense in depth against scripted probing and log noise, not the security boundary: a 256-bit token is
unguessable regardless of request rate, and the design should say so plainly rather than pretend the rate limit is
what protects the data.

## Feature gate

Off by default. Two new variables, both registered in `apps/application/shared/piwi-env-vars.ts` in the same change
that reads them, each with a `since` stamp for the shipping release — the registry rule from
[apps/application/AGENTS.md](../apps/application/AGENTS.md), enforced by `tests/unit/piwi-env-vars.test.ts` (an
unregistered referenced var, a missing `since`, or a drifted default fails the suite):

- **`PIWI_SHARE_LINKS_ENABLED`** — boolean, default `false`. When disabled, mint endpoints return 403 with an explicit
  message and the public routes return 404. Existing rows are kept but resolve 404, so the variable doubles as an
  operator kill switch: flipping it off dead-ends every outstanding link immediately without deleting anything.
- **`PIWI_SHARE_LINK_MAX_TTL_DAYS`** — number, default `30`. The creation UI offers expiries up to this many days;
  `0` means links may be minted without an expiry (`expires_at` null). Operators who never want an immortal link keep
  the default.

## UI

- A **Share** action beside the existing Export menu on the execution and cluster detail pages —
  `app/components/shared/ExportMenu.vue` is mounted from `app/pages/test-run-cases/[id].vue` and
  `app/pages/failure-clusters/[id].vue`, and the share button lives in the same header group.
- The share modal mints a link, shows the full URL **once** with a copy button and the one-time warning, and offers
  the expiry picker bounded by `PIWI_SHARE_LINK_MAX_TTL_DAYS`.
- A per-entity list of active links (prefix, creator, expiry, views) with one-click revoke, in the same modal.
- An admin list of all links per project in project settings (`app/pages/projects/[id]/edit.vue`), for the "what is
  exposed right now" audit.

The components follow the existing shared-component rules (Nuxt UI primitives, `SectionCard`, the inline-help
convention) — the specifics belong to the implementation PR, not this proposal.

## Security posture

- **The anonymous surface is two GET routes.** Nothing else changes its authentication story; in particular the
  existing `/api/files/[...path]` route stays session/key-authenticated and is not reachable through a share token.
- **Everything served is data the link creator could already see.** Minting requires project access on the entity, so
  a share link is a narrower delegation of an existing member's read access — never an escalation.
- **Assets are restricted to the resolved bundle.** The asset route first resolves the token to its bundle, then
  serves a storage path only if it appears in that bundle's asset list. The token grants exactly the evidence of one
  entity — it is not a general read capability over project storage — and the `serverAssetReader` traversal guard
  applies on top.
- **Response headers on both share routes:** `Cache-Control: no-store` (matching what the files route sets for
  content-mutable paths), `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` (both new — no current
  route needs them because no current route is public), and `X-Content-Type-Options: nosniff` on asset responses.
- **Stored HTML and SVG evidence keeps its sandbox.** The share asset route applies the same CSP treatment as
  `server/api/files/[...path].get.ts`: `sandbox allow-scripts` for HTML (unique opaque origin, no cookies, no
  credentialed calls back to `/api`) and the inert-image sandbox for SVG. A hostile uploaded report opened through a
  share link gets no more purchase than it gets today.
- **No cookies are set or read on share routes.** The page renders purely from the token. A logged-in viewer opening a
  share link must see exactly what an anonymous viewer sees — the share view never widens itself with the viewer's
  session, so a screenshot of it can be trusted to show what the recipient will get, and the response can never leak
  session-derived state into a cacheable/anonymous context.
- **In-scope for security reports.** [SECURITY.md](../SECURITY.md) lists authentication/authorization bypass and path
  traversal in file storage as report classes we especially care about; this feature adds exactly the kind of surface
  those classes cover and must hold that bar.

**The token lives in the URL path — acknowledge the tradeoff.** Capability URLs end up in browser history, server and
reverse-proxy access logs, and (absent countermeasures) the Referer header of any outbound navigation. The
mitigations: `Referrer-Policy: no-referrer` on share responses, the short default TTL (30 days), one-click revocation,
and `noindex` so a leaked link does not become a search result. This is the standard tradeoff every capability-URL
design makes (compare Google Docs "anyone with the link"); the alternative — a viewer login — is precisely what the
feature exists to avoid.

## Retention interplay

Retention (`apps/application/server/utils/retention.ts`, run nightly by `server/tasks/retention/sweep.ts`) prunes runs
older than the opt-in `PIWI_RETENTION_DAYS`. Share links intersect it in three ways:

- **A link whose entity is pruned resolves 404** — indistinguishable from an invalid token, per the validation rules.
- **`sweepOrphans` gains one more predicate** deleting `share_links` rows whose entity no longer exists. The rows need
  the sweep because `entity_id` is polymorphic over two tables and carries no FK; the sweep is already idempotent and
  set-based, and this follows its existing pattern (`NOT EXISTS` against the parent table per `entity_kind`).
- **Cluster links survive pruning but progressively lose evidence.** `deleteRunsOlderThan` calls
  `recomputeClusterOccurrences` (`shared/handlers/failure-cluster-ops.ts`) so clusters persist while their member
  executions are pruned. A cluster share link therefore keeps resolving, showing the cluster's stats and whatever
  member evidence still exists — the same progressive thinning the dashboard itself shows. Stated plainly: a
  long-lived cluster link degrades gracefully; it does not freeze evidence, and an export is the right tool when the
  evidence must outlive retention (that is already `offline-export.md`'s pitch).

## Demo and desktop

- **Demo.** `npm run app:check:demo` (`apps/application/scripts/check-demo-routes.mjs`) fails when a server API route
  has no demo handler. The share routes go on its `INTENTIONALLY_EXCLUDED` list with a justification in the
  established style: the demo has no accounts and its data is already public, so a share link adds nothing there —
  and there is no server to mint against.
- **Desktop.** The feature stays available in the desktop build (it is the same server), but honesty about usefulness:
  the bundled server binds loopback-only and its local-access guard (`server/middleware/desktop-guard.ts`) requires
  the per-install desktop token on every `/api` request, so a generated share URL is unreachable for anyone but the
  machine's own user — on desktop, offline export remains the real answer for handing an investigation over.

## Alternatives considered

1. **Signed URLs (HMAC over entity + expiry, no DB row).** Stateless and table-free, but there is no way to revoke one
   link without rotating the signing key (killing all links), nothing to list in an admin view, and no view stats.
   Rejected: a tiny table buys revocation, listing and stats, and the table is not the hard part of this feature.
2. **A special "share viewer" identity through the existing auth path.** Threading a pseudo-user through
   `requireAuth` would sprinkle bypass logic across the auth stack — `requireAuth` already has one special case
   (virtual admin when auth is disabled) and every consumer would need to reason about a second. Rejected in favor of
   a parallel route family that is *explicitly* public: the reader of `server/api/share/` sees exactly what anonymous
   requests can reach, and the auth path stays untouched.
3. **A frozen snapshot at share time (copy the bundle to storage).** Predictable — the viewer sees what the sharer
   saw — but it duplicates storage per link, goes stale the moment a diagnosis lands, and sits oddly beside
   revocation (the copy exists until something garbage-collects it). Rejected: live resolve matches both "keep the
   history" (the ROADMAP's first purpose — the link shows the history as it is now) and the revocation semantics
   (revoked means gone, immediately). Pinning a cluster's state is listed as an open question, not a v1 behavior.
4. **Static-file sharing (export + any file host).** Already possible today with the shipped offline export, and it
   stays the answer for sharing without exposing a server at all. This feature does not replace it; it covers the
   live case the file cannot.

## Open questions

- **Should `user`-role members mint links?** v1 says no (mint is `['administrator', 'reporter']`), but a `user` can
  already export the same data to a file, so the restriction governs creating anonymous surface, not data access. Is
  that distinction worth the asymmetry?
- **Should a link optionally pin a cluster's state at share time?** An "as of when I shared it" toggle would
  reintroduce the snapshot alternative in opt-in form. Deferred until someone asks with a concrete case.
- **Whole-run links.** ROADMAP's Exploring entry for exporting whole runs says a run export "would follow the same
  shape" as the existing exports; once a run bundle exists, `entity_kind: 'run'` follows this design unchanged.
- **Default TTL.** 30 days is proposed; is the right default shorter (7) for a link whose value is "look at this now"?

## Rollout sketch

1. **Server.** The `share_links` table in both schemas plus generated migrations; mint/list/revoke endpoints; the two
   public routes; the rate limit; both env vars registered with `since` stamps. Unit tests for the token lifecycle
   (mint → hash → resolve → expire → revoke, and the gate-off behavior); Playwright E2E for the public routes
   with auth enabled — an anonymous request reaches a valid link, gets 404 on a revoked one, and never reaches
   anything else — with test project names registered in `shared/test-project-names.ts` per the root
   [AGENTS.md](../AGENTS.md) rule.
2. **UI.** Share modal, per-entity link list, project-settings admin list; feature screenshots per the
   feature-screenshot rule in [apps/application/AGENTS.md](../apps/application/AGENTS.md) (scenes in
   `scripts/take-feature-screenshots.mjs`).
3. **Docs.** A page under "Reading the results" (the sidebar group in `apps/docs/.vitepress/config.mts`), linked from
   `offline-export.md` as the live counterpart; the configuration reference picks the new vars up from the registry
   automatically.
