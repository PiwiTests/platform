/**
 * Pure catalog filtering for the MCP route. Kept free of DB and request access
 * so it is unit-testable with a plain states map: the route gathers the states
 * and the module set, these functions decide what is served.
 */
import type { CapabilityId, CapabilityModule, CapabilityState } from '#shared/capabilities';
import type { McpToolDef } from '#shared/mcp-tools';

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
