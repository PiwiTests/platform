---
title: Timeline markers
lang: en-US
---

# Timeline markers

<Needs reporter admin />

Timeline markers let you record **dated events** against a project — a deploy, a config change, an infrastructure migration, a dependency bump, an incident — and see them overlaid as vertical lines on the analytics trend charts. When a pass-rate drop or a performance regression lines up with a marker, you have your prime suspect: "the slowdown started the day we switched CI runners".

## What a marker is

Each marker belongs to one project and carries:

- **Label** — a short title (e.g. _Migrated CI to ARM runners_).
- **Date & time** — when the event happened; this is where the line is drawn.
- **Category** — one of `deploy`, `config`, `infra`, `incident`, `release`, or a generic `event`. The category sets the marker's icon and color.
- **Environment** _(optional)_ — scope the marker to a single environment (e.g. `staging`). Leave it empty to apply to all environments.
- **Description** _(optional)_ — free-text detail.

## Where markers show up

- **Project charts** — the **Run trend** and **Performance trend** charts render each marker as a dashed vertical line with a colored flag handle. Hover the handle for the marker's details; click it to open the **Markers** panel focused on that marker.
- **Markers panel** — a **Markers** button beside the **Run trend** chart (on the project's Runs tab) opens a panel listing the project's markers, with add / edit / delete controls.
- **Test-case history** — a single test's duration history chart shows the same markers, so you can tell whether an event affected that specific test.
- **Run detail** — a run shows an **"After: …"** chip for the nearest preceding marker, so a single run tells you which event it followed.
- **Run compare** — comparing two runs surfaces any markers that fall between them ("something changed between these runs").

## Environment scoping

Markers tie into the project's existing **environment filter**. When you filter the project view to one or more environments, the charts show only markers that match the selected environment(s) plus any global (no-environment) markers. This keeps a staging-only event from cluttering your production view.

The environment field is free text, with suggestions drawn from the environments already seen in the project's runs (set via the reporter's `environment` option / `PIWI_ENVIRONMENT`).

## Who can edit markers

Reading markers is available to any signed-in user with access to the project. Creating, editing, and deleting them requires the **reporter** or **administrator** role. (When authentication is disabled, everyone can edit.)

## Automatic markers

Piwi can create markers for you when a run's tooling changes. On each finished run it compares the run against the previous run **in the same environment** and, when the **Playwright version** or **reporter version** changed, adds an `auto` marker (category `config`) at that run's time — for example _Playwright 1.49.0 → 1.50.0_. Auto markers are labeled with a small sparkle icon and can be edited or deleted like any other.

This is enabled by default. Set `PIWI_AUTO_MARKERS=false` to turn it off. See the [configuration reference](/reference/configuration).

## API

Markers are managed through the REST API (`GET`/`POST /api/projects/:id/markers`, `PATCH`/`DELETE /api/markers/:id`). See the interactive [API docs](https://piwitests.dev/demo/docs) for request and response shapes.
