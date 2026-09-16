---
title: Share links
lang: en-US
---

# Share links

<Needs reporter />

A share link is a read-only URL for one execution or one failure cluster that anyone can open — no dashboard
account, no login. It is the live counterpart of an [offline export](./offline-export): instead of a file frozen at
export time, the link renders the investigation as it stands when it is opened.

Share links are **off by default**. Set `PIWI_SHARE_LINKS_ENABLED=true` to allow them — see the
[configuration reference](/reference/configuration#authentication).

The [live demo](https://piwitests.dev/demo/) runs without a server, so it has no share links and hides the **Share**
button.

## Creating a link

On an execution page or a failure-cluster page, open **Share** (next to **Export**):

1. Pick an expiry. The dialog offers lifetimes up to `PIWI_SHARE_LINK_MAX_TTL_DAYS` (30 days unless configured;
   setting it to `0` lifts the cap and allows links with no expiry).
2. **Copy the link immediately — it is shown only once.** The server stores a hash of the token, not the token, so
   there is no way to display the URL again later. Mint a new link instead.

Creating and revoking links requires the administrator or reporter role; any project member can see which links
exist. Each entry in the dialog shows the link's prefix, its expiry state, and how many times it was opened.

## What the viewer sees

The link serves the same self-contained HTML report the [offline export](./offline-export) produces, rebuilt from
the current data on every view — a diagnosis added after the link was minted shows up, a cluster marked fixed reads
as fixed. The same size budgets apply (`PIWI_EXPORT_MAX_*`), so an anonymous view can never cost the server more
than an authenticated export does.

Two consequences of "live" worth knowing:

- **Retention thins a shared cluster over time.** When [data retention](/operate/storage#data-retention) prunes old runs, a
  cluster link keeps resolving but progressively loses member evidence — the same thinning the dashboard shows. A
  link whose entity is pruned entirely answers 404. When the investigation must outlive retention, hand over an
  export file instead.
- **Revocation is immediate.** A revoked link stops resolving on the next request. Turning the feature off entirely
  (`PIWI_SHARE_LINKS_ENABLED` unset) dead-ends every outstanding link at once without deleting anything, so the
  variable doubles as a kill switch.

## Security properties

- The token is a 256-bit random secret (`psl_` + 64 hex characters) — unguessable at any request rate. The server
  stores only its SHA-256 hash.
- Everything a link serves is data its creator could already see: minting requires project access, so a link is a
  narrower delegation of an existing member's read access, never an escalation.
- The rendered page is sandboxed into a unique origin and served with `noindex` and `Referrer-Policy: no-referrer`,
  so it cannot read dashboard cookies, call the API with credentials, or leak the URL through outbound links. Share
  responses are never cached.
- A share URL is a capability: anyone holding it can view the page, and it can end up in browser history or proxy
  logs like any URL. Prefer short expiries, and revoke links when an investigation closes.

## See also

- [Offline export](./offline-export) — the file to hand over when the recipient has no network path to your instance
- [Authentication](/operate/authentication) — roles, and who can mint or revoke
- [Storage configuration](/operate/storage#data-retention) — retention, and how it interacts with long-lived links
