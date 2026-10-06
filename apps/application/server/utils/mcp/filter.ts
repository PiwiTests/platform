/**
 * Pure catalog filtering for the MCP route. Kept free of DB and request access
 * so it is unit-testable with a plain states map: the route gathers the states,
 * the module set and the caller's access, these functions decide what is served.
 */
import type { CapabilityId, CapabilityModule, CapabilityState } from '#shared/capabilities';
import { toolPermissions, type McpToolDef } from '#shared/mcp-tools';
import { holdsAnywhere, type AccessSummary } from '#shared/permissions';

/**
 * Drop every tool whose capability is declined; keep all others. A tool with no
 * capability is never dropped, and undecided, available and active capabilities
 * all keep their tools — only an explicit instance decline removes one.
 */
export function filterServeableTools<T extends Pick<McpToolDef, 'capability'>>(
  tools: readonly T[],
  states: Record<CapabilityId, CapabilityState>,
): T[] {
  return tools.filter((tool) => !(tool.capability && states[tool.capability] === 'declined'));
}

/**
 * Narrow a list to a set of modules; `null` means no narrowing. Narrowing only
 * removes tools, so it can never re-add one that {@link filterServeableTools}
 * already dropped.
 */
export function narrowToolsByModule<T extends Pick<McpToolDef, 'module'>>(
  tools: readonly T[],
  modules: Set<CapabilityModule> | null,
): T[] {
  return modules ? tools.filter((tool) => modules.has(tool.module)) : [...tools];
}

/**
 * Leave out the tools the caller can never use: a tool declaring a permission
 * (`McpToolDef.permission`, any one of several) that the caller holds on no
 * project. Read tools declare none and stay; the project scope decides what
 * they read. Like module narrowing, this only removes tools from the list.
 */
export function narrowToolsByAccess<T extends Pick<McpToolDef, 'permission'>>(
  tools: readonly T[],
  access: AccessSummary,
): T[] {
  return tools.filter((tool) => {
    const permissions = toolPermissions(tool);
    return permissions.length === 0 || permissions.some((permission) => holdsAnywhere(access, permission));
  });
}
