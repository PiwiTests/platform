/**
 * How the access screens (Settings → Users, Groups and Permissions, and a
 * project's Members) name project roles and where a role comes from. The roles
 * and their labels are in `#shared/permissions`; this file only turns them
 * into select items and short sentences.
 */
import { PROJECT_ROLE_DESCRIPTIONS, PROJECT_ROLE_LABELS, PROJECT_ROLES, ProjectRole } from '#shared/permissions';
import type { InheritedRole, ProjectMemberView } from '#shared/project-access';

/** The value a role select uses for "no role": a select item cannot hold null. */
export const NO_PROJECT_ROLE = 'none';

export type ProjectRoleChoice = ProjectRole | typeof NO_PROJECT_ROLE;

export interface ProjectRoleSelectItem {
  label: string;
  value: ProjectRoleChoice;
  description?: string;
}

/** Select items for `roles` (every role by default), optionally led by a "No role" item. */
export function projectRoleSelectItems(
  roles: readonly ProjectRole[] = PROJECT_ROLES,
  options: { none?: boolean; descriptions?: boolean } = {},
): ProjectRoleSelectItem[] {
  const items: ProjectRoleSelectItem[] = roles.map((role) => ({
    label: PROJECT_ROLE_LABELS[role],
    value: role,
    ...(options.descriptions ? { description: PROJECT_ROLE_DESCRIPTIONS[role] } : {}),
  }));
  return options.none ? [{ label: 'No role', value: NO_PROJECT_ROLE }, ...items] : items;
}

/** A select value back to a role, null for "No role". */
export function projectRoleFromChoice(choice: unknown): ProjectRole | null {
  return (PROJECT_ROLES as readonly unknown[]).includes(choice) ? (choice as ProjectRole) : null;
}

const RANKED_ROLES: readonly ProjectRole[] = [
  ProjectRole.VIEWER,
  ProjectRole.CONTRIBUTOR,
  ProjectRole.MAINTAINER,
  ProjectRole.PROJECT_ADMIN,
];

/**
 * The role to show for several held at once: the highest of Viewer to Project
 * admin, each including the one before it; Uploader only when it is the only
 * one, since it grants nothing a Maintainer lacks.
 */
export function strongestProjectRole(roles: readonly ProjectRole[]): ProjectRole | null {
  for (let i = RANKED_ROLES.length - 1; i >= 0; i--) {
    if (roles.includes(RANKED_ROLES[i]!)) return RANKED_ROLES[i]!;
  }
  return roles.includes(ProjectRole.UPLOADER) ? ProjectRole.UPLOADER : null;
}

/** "Maintainer through QA", "Viewer on all projects": a role a grid cell holds from elsewhere. */
export function inheritedRoleText(inherited: InheritedRole): string {
  const label = PROJECT_ROLE_LABELS[inherited.role];
  return inherited.source === 'group' ? `${label} through ${inherited.groupName}` : `${label} on all projects`;
}

/** Where a project member's role comes from, as a short phrase ("through QA", "on all projects"). */
export function projectMemberSourceText(member: Pick<ProjectMemberView, 'source' | 'groupName'>): string {
  switch (member.source) {
    case 'direct':
      return 'on this project';
    case 'all-projects':
      return 'on all projects';
    case 'group':
      return `through ${member.groupName}`;
    case 'administrator':
      return 'as an administrator';
  }
}
