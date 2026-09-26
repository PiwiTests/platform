---
title: Project access
description: "Scope Reporter and User accounts to the projects assigned to them, globally or per project, and edit every assignment on the permission grid."
lang: en-US
---

# Project access

Administrators see every project. **Reporter** and **User** accounts see only the projects they are **assigned** to,
so you can give each team its own slice of the dashboard. Project access applies only with
[authentication](./authentication) on; the [roles](./authentication#roles) say what each account can do inside the
projects it opens.

An assignment is one of two kinds:

- **Global**: access to *all* projects, including ones created later. Good for a shared CI reporter or a team lead.
- **Per-project**: access to a specific set of projects only.

What scoping affects for a non-admin user:

- The project list, sidebar menu, home dashboard, recent runs, and search only include assigned projects.
- Runs, test cases, and clusters that belong to an unassigned project return **403**.
- A reporter can submit results to an assigned project. Creating a **new** project on first submission requires
  **global** access: a per-project reporter can't invent projects.

> **Default is no access.** A freshly created Reporter or User has no assignments and sees an empty dashboard until you
> grant some, and so does an account whose last project you revoke. (Once, on a database with no assignments yet,
> existing Reporter and User accounts are given global access, so upgrading from a version without project access
> changes nothing for them.)

## Managing assignments

Assignments are administrator-only and can be edited from three places:

- **All at once**: **Settings → Permissions**, the [permission grid](#permission-grid): every user against every project.
- **Per user**: **Settings → Users → Project access** (the action next to a user). Choose global access or tick
  specific projects.
- **Per project**: the **Members** section of a project's **Settings** tab. Add or remove users for that one project.

All three edit the same underlying assignments, so use whichever is more convenient.

## Permission grid

**Settings → Permissions** lays every user against every project on one grid, so you can read and change access for
the whole instance without opening accounts one at a time. Rows are users, grouped by role; columns are projects,
after an **All projects** column. A tick grants that role in that project: a reporter can upload results and triage
there, a user can read.

<div class="doc-screenshot">
  <img src="/screenshots/permission-grid.png" alt="Settings → Permissions: users grouped by role down the side, projects across the top, and the focused cell's row and column highlighted">
</div>

- **Every click saves at once**; there is no Save button. A change the server refuses is rolled back and reported.
- **All projects** also covers projects created later. While it is ticked, the user's project cells show a faint tick
  and are locked; unticking it returns the user to exactly the projects ticked one by one.
- **Administrators** open every project, so their row is ticked and locked.
- **Hovering a cell highlights its row and column**, so a cell far from the headers still reads against its user and
  its project. Keyboard focus does the same: Tab enters the grid as one stop, the arrow keys move between cells,
  Space toggles.
- **Filter users** and **Filter projects** narrow the grid on a large instance.

Scripts can read and change the same assignments through the API; see the
[API docs](https://piwitests.dev/demo/docs).

> **Try it in the demo:** the [live demo](https://piwitests.dev/demo/) ships with several pre-seeded identities: an
> admin, a global CI reporter, and users scoped to one or two projects (plus one with none). Use the **Acting as**
> picker in the demo banner to switch between them and watch the project list, sidebar, and search change to match
> each user's access. Acting as the admin, change the assignments live and switch back to see the effect. See
> [UI overview → Live demo](/features/ui-overview#live-demo).

## Related

- [Authentication](./authentication): turning sign-in on, roles and user management
- [API keys](./api-keys): a key acts with its owner's role and project access
- [Production checklist](./production-checklist): what to set before anyone else can reach the instance
