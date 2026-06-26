/**
 * Canonical list of demo users.
 *
 * Single source of truth shared by:
 *  - the demo seed generator (`scripts/generate-demo-seed.mjs` imports the
 *    sibling `demo-users.json`) which seeds the `users` and
 *    `project_assignments` tables, and
 *  - the app at runtime (this module) so the demo "act as" user switcher and
 *    `useAuth` can present the same set of identities.
 *
 * The roles and assignments here are intentionally varied so the project
 * affectation feature is observable in the demo: an admin (sees everything),
 * a reporter with global access, a user scoped to a single project, a user
 * scoped to two projects, and a user with no access yet.
 */
import demoUsersData from './demo-users.json';
import { Role } from '~~/shared/types';

export interface DemoUser {
  id: number;
  username: string;
  name: string;
  email: string;
  role: Role;
  assignment: { global: boolean; projectIds: number[] };
}

export const DEMO_USERS = demoUsersData as DemoUser[];

/** Default identity used on first load (the admin). */
export const DEFAULT_DEMO_USER_ID = 1;

/** localStorage key holding the currently selected demo user id. */
export const DEMO_USER_STORAGE_KEY = 'piwi-demo-user-id';

export function findDemoUser(id: number | null | undefined): DemoUser {
  return DEMO_USERS.find((u) => u.id === id) ?? DEMO_USERS[0]!;
}
