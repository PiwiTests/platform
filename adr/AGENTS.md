# ADRs — agent guide

Rules for the `adr/` directory: the architecture decision records for programs that have shipped. Read
[`../AGENTS.md`](../AGENTS.md) first for repo-wide conventions.

## What lives here, and what lives in `proposals/`

The two directories split by state, not by topic:

| Directory | Holds | Status |
|-----------|-------|--------|
| [`proposals/`](../proposals/) | Design records for work that is proposed or still being built | proposed / in progress |
| `adr/` | Architecture decision records for decisions that have shipped | accepted |

A proposal moves here when its plan has shipped. The move is a rename into `adr/` with the **same filename**, plus the
ADR header below — the body is preserved as the detailed record. A proposal with unbuilt work stays in `proposals/`
until it ships; do not move it early.

## Format

Every ADR is one file, named after the decision (the proposal's filename, unchanged). The header is mandatory and sits
directly under the title:

```markdown
# <Title>

- Status: accepted
- Date: <YYYY-MM-DD>

<the proposal body, preserved>
```

- **Status** is one of the ADR vocabulary: `accepted` (shipped), `proposed` (not yet shipped — but those stay in
  `proposals/`), `superseded` (replaced by a later ADR), `deprecated` (the decision no longer holds).
- **Date** is the date the decision was accepted — the day the plan shipped, not the day the proposal was written.

The body keeps the proposal's own sections. They map onto the ADR sections a reader expects:

| ADR section | Proposal section |
|-------------|------------------|
| Context | `Summary` / `Problem` |
| Decision | `Decisions` (the D1, D2, … table) |
| Consequences | `Risks` / `Not in this plan` / `Open questions` |

A new ADR written from scratch uses the canonical sections directly — `## Context`, `## Decision`, `## Consequences` —
rather than the proposal section names.

## Rules

- **One decision per file.** A proposal that records several independent decisions is one ADR; do not split it.
- **Never edit a shipped ADR's decisions.** The record says what was decided and why. A later change is a new ADR that
  supersedes the old one (set the old `Status` to `superseded` and link the new one), not an edit to the old body.
- **Keep the filename stable.** The filename is the decision's identity; cross-references and the roadmap link to it.
- **Cross-references stay relative.** A link to another ADR is `[name.md](name.md)`; a link to a still-open proposal is
  `[name.md](../proposals/name.md)`; a link to the roadmap is `[ROADMAP.md](../ROADMAP.md)`.
- **The status line in the body is history.** The proposal's `**Status.** …` narrative stays as-is; the header's
  `Status` is the controlled value. When the two disagree, the header wins.
