/**
 * Canonical demo identities and groups.
 *
 * Single source of truth shared by:
 *  - the demo seed generator (`scripts/generate-demo-seed.mjs` imports the
 *    sibling `demo-users.json`), which seeds the `users`, `groups`,
 *    `group_members` and `role_bindings` tables, and
 *  - the app at runtime (this module), so the demo "act as" user switcher and
 *    `useAuth` present the same set of identities.
 *
 * The personas cover each instance and project role, directly and through
 * groups, so the access model is observable in the demo: an administrator, a
 * QA lead (Project admin of one project, Maintainer elsewhere through the QA
 * group), a QA engineer (Maintainer everywhere through the QA group), a
 * product owner (Contributor on two projects through the Product owners
 * group), a CI account (Uploader everywhere), a stakeholder (Viewer of one
 * project) and a member with no access yet.
 */
import demoData from './demo-users.json';
import {
  buildAccessSummary,
  InstanceRole,
  type AccessSummary,
  type ProjectRole,
  type RoleBindingGrant,
} from '#shared/permissions';

export interface DemoUser {
  id: number;
  username: string;
  name: string;
  email: string;
  instanceRole: InstanceRole;
  /** What the persona is, for the switcher ("QA lead"). */
  label: string;
  /** One line on what the persona can do, for the switcher. */
  description: string;
  /** The persona's own role bindings (`projectId` null: all projects). */
  bindings: { projectId: number | null; role: ProjectRole }[];
}

export interface DemoGroup {
  id: number;
  name: string;
  description: string;
  memberIds: number[];
  bindings: { projectId: number | null; role: ProjectRole }[];
}

export const DEMO_USERS = demoData.users as DemoUser[];
export const DEMO_GROUPS = demoData.groups as DemoGroup[];

/** Default identity used on first load (the administrator). */
export const DEFAULT_DEMO_USER_ID = 1;

/** localStorage key holding the currently selected demo user id. */
export const DEMO_USER_STORAGE_KEY = 'piwi-demo-user-id';

/**
 * Cookie carrying the selected demo user id to the service worker. The built
 * SPA's data fetching does not attach request headers, so the worker reads the
 * "act as" identity from this cookie (via the Cookie Store API) instead. Set by
 * the demo-fetch plugin, read by the demo service worker.
 */
export const DEMO_USER_COOKIE = 'piwi-demo-user';

export function findDemoUser(id: number | null | undefined): DemoUser {
  return DEMO_USERS.find((u) => u.id === id) ?? DEMO_USERS[0]!;
}

/**
 * A persona's access as seeded: their own bindings and their groups'. The
 * service worker reads the in-browser database instead, so access changed in
 * Settings → Permissions shows in `/api/auth/me`, not here.
 */
export function demoAccessFor(id: number | null | undefined): AccessSummary {
  const user = findDemoUser(id);
  // An administrator holds every permission, so their bindings are not read (as `getUserAccess` does).
  if (user.instanceRole === InstanceRole.ADMINISTRATOR) return buildAccessSummary(InstanceRole.ADMINISTRATOR, []);
  const grants: RoleBindingGrant[] = [
    ...user.bindings,
    ...DEMO_GROUPS.filter((group) => group.memberIds.includes(user.id)).flatMap((group) => group.bindings),
  ];
  return buildAccessSummary(InstanceRole.MEMBER, grants);
}
