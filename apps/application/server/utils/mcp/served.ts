/**
 * Which MCP tools this instance serves. A tool whose capability is declined at
 * instance level is dropped; every other tool is served. The stored decisions
 * are one cheap settings read, so the evidence probes behind
 * {@link resolveInstanceStates} run only when a decline is actually stored.
 */
import { getInstanceDecisions, resolveInstanceStates } from '#shared/handlers/setup-status';
import type { McpToolDef } from '#shared/mcp-tools';
import { filterServeableTools } from './filter';
import type { DbClient } from '../../database';

/** True when any capability carries a stored instance decline. */
function hasDecline(decisions: Record<string, unknown>): boolean {
  return Object.values(decisions).some((v) => v === 'declined');
}

/** The tools from `tools` this instance serves. */
export async function serveableTools<T extends Pick<McpToolDef, 'capability'>>(
  db: DbClient,
  tools: readonly T[],
): Promise<T[]> {
  if (!hasDecline(await getInstanceDecisions(db))) return [...tools];
  return filterServeableTools(tools, await resolveInstanceStates(db));
}
