import { getRequestURL, type H3Event } from 'h3';
import { requireAuth, isAuthEnabled } from '../utils/auth';
import { getDatabase, type DbClient } from '../database';
import { MCP_TOOLS, DESKTOP_MCP_TOOLS, toContent } from '../utils/mcp/tools';
import type { McpContext, McpTool } from '../utils/mcp/tools';
import { getPrompt, isKnownPrompt } from '../utils/mcp/prompts';
import { getProjectScope } from '../utils/project-access';
import { resolvePublicBaseUrl } from '../utils/oauth-helpers';
import { ok, rpcErr, RPC, mcpServerInfo, negotiateProtocolVersion } from '../utils/mcp/protocol';
import type { JsonRpcRequest } from '../utils/mcp/protocol';
import { MCP_PROMPT_DEFS } from '#shared/mcp-prompts';
import { resolveInstanceStates, getInstanceDecisions } from '#shared/handlers/setup-status';
import { CAPABILITY_MODULES, type CapabilityModule } from '#shared/capabilities';
import { filterServeableTools, narrowToolsByModule } from '../utils/mcp/filter';

// The desktop app's bundled server (launched with PIWI_DESKTOP_TOKEN) advertises
// the shared catalog plus the desktop-only tools that read and write files on the
// machine it runs on; a hosted/Docker/npx server serves the shared catalog only.
const IS_DESKTOP = !!process.env.PIWI_DESKTOP_TOKEN;
const ACTIVE_TOOLS = IS_DESKTOP ? [...MCP_TOOLS, ...DESKTOP_MCP_TOOLS] : MCP_TOOLS;
const TOOL_BY_NAME = new Map(ACTIVE_TOOLS.map((t) => [t.name, t]));
const MAX_BODY_BYTES = 1_048_576; // 1 MB — reject oversized batches early

const KNOWN_MODULES = new Set<CapabilityModule>(CAPABILITY_MODULES);

/** True when any capability carries a stored instance decline. */
function hasDecline(decisions: Record<string, unknown>): boolean {
  return Object.values(decisions).some((v) => v === 'declined');
}

/**
 * The tools this instance serves: the full active catalog minus every tool whose
 * capability is declined at instance level. Undecided, available and active
 * capabilities all keep their tools, so an upgrade never silently shrinks the
 * list — only an explicit decline drops one.
 *
 * A tool can only be dropped when a decline is stored, so the cheap settings
 * read comes first and the twelve evidence probes run only when one exists.
 */
async function serveableTools(db: DbClient): Promise<McpTool[]> {
  if (!hasDecline(await getInstanceDecisions(db))) return [...ACTIVE_TOOLS];
  return filterServeableTools(ACTIVE_TOOLS, await resolveInstanceStates(db));
}

/**
 * The tool a `tools/call` may run, or null when the name is unknown or its
 * capability is declined. A tool with no capability needs no query; a tool with
 * one needs the evidence probes only when its capability carries a stored
 * decline, since evidence still wins over a decline.
 */
async function serveableTool(db: DbClient, name: string | undefined): Promise<McpTool | null> {
  const tool = name ? TOOL_BY_NAME.get(name) : undefined;
  if (!tool || !tool.capability) return tool ?? null;
  if ((await getInstanceDecisions(db))[tool.capability] !== 'declined') return tool;
  return (await resolveInstanceStates(db))[tool.capability] === 'declined' ? null : tool;
}

/**
 * Parse the `?modules=core,healing` narrowing on the MCP URL. Unknown values are
 * ignored; an absent, empty or all-unknown value means no narrowing. Narrowing
 * only hides tools from the list, it never re-enables a declined one.
 */
function parseModules(raw: string | null): Set<CapabilityModule> | null {
  if (!raw) return null;
  const picked = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CapabilityModule => KNOWN_MODULES.has(s as CapabilityModule));
  return picked.length > 0 ? new Set(picked) : null;
}

// ── MCP Streamable HTTP endpoint ─────────────────────────────────────────────
//
// Implements the MCP 2024-11-05 Streamable HTTP transport.
// A single POST /mcp handles initialize, tools/list, tools/call, and ping.
// Auth: same pd_<key> Bearer token as the REST API.

export default eventHandler(async (event) => {
  // CORS — MCP clients are typically local desktop apps or CLI tools that
  // may POST from a different origin than the dashboard UI.
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
  });

  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204);
    return null;
  }

  // Authenticate using the same API-key / session mechanism as the REST API,
  // then resolve the caller's project scope. Every tool honors this scope so a
  // non-admin key can only read the projects it is assigned to — the same
  // isolation the REST API enforces.
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user);
  const ctx: McpContext = { user, scope };

  const contentLength = Number(event.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    setResponseStatus(event, 413);
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC.INVALID_REQUEST, message: 'Request body too large (max 1 MB)' },
    };
  }

  const body = await readBody<JsonRpcRequest | JsonRpcRequest[]>(event);
  const requests = Array.isArray(body) ? body : [body];

  const responses = await Promise.all(requests.map((req) => handleRequest(ctx, req, event, db)));

  // Notifications (no id) have no response — filter them out.
  const toSend = responses.filter((r) => r !== null);

  setResponseHeader(event, 'Content-Type', 'application/json');
  return Array.isArray(body) ? toSend : (toSend[0] ?? null);
});

async function handleRequest(ctx: McpContext, req: JsonRpcRequest, event: H3Event, db: DbClient) {
  if (!req || req.jsonrpc !== '2.0' || !req.method) {
    return rpcErr(req?.id, RPC.INVALID_REQUEST, 'Invalid JSON-RPC request');
  }

  // Notifications (no id) — fire and forget
  if (req.id === undefined || req.id === null) {
    if (req.method === 'notifications/initialized') return null;
    return null;
  }

  try {
    return await dispatch(ctx, req, event, db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[MCP] error handling', req.method, message);
    return rpcErr(req.id, RPC.INTERNAL_ERROR, message);
  }
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

async function dispatch(ctx: McpContext, req: JsonRpcRequest, event: H3Event, db: DbClient) {
  const { id, method, params } = req;

  switch (method) {
    // ── Protocol handshake ──────────────────────────────────────────────────
    case 'initialize': {
      const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(requested),
        capabilities: { tools: {}, prompts: {} },
        serverInfo: mcpServerInfo(useRuntimeConfig(event).public.appVersion as string, { desktop: IS_DESKTOP }),
        instructions:
          `${IS_DESKTOP ? 'Piwi desktop app' : 'Piwi Dashboard'} MCP server — query Playwright test results, failure clusters, AI diagnoses, and SCM diffs. ` +
          'Start with list_projects to discover project IDs. ' +
          'List tools return {items, nextCursor}; pass nextCursor back (when non-null) to page. ' +
          'IDs: testCaseId = stable test identity; executionId/testRunsCaseId = one per-run execution. ' +
          'Errors are truncated; use get_test_run_case for full error text and explain_failure for a one-call evidence bundle. ' +
          'Write/triage tools (set_cluster_status, run_cluster_diagnosis, set_cluster_base_commit, submit_diagnosis_feedback) require reporter or admin access. ' +
          'Tools belong to four modules (core, workflow, healing, agents); an instance can decline a module and its tools then disappear from this list, and appending ?modules=core (a comma-separated set) to the MCP URL narrows the list to those modules. ' +
          'The setup_piwi prompt (prompts/get) generates a ready-to-run setup for a Playwright project not yet reporting here.' +
          (IS_DESKTOP
            ? ' This is the local desktop app, running on your machine: it adds tools that reach the disk — import_local_report (pull a local blob/trace .zip into a project), read_local_source (read the current on-disk source) and apply_locator_fix (apply a recommended locator fix to the real file).'
            : ''),
      });
    }

    case 'ping': {
      return ok(id, {});
    }

    // ── Tool listing ─────────────────────────────────────────────────────────
    case 'tools/list': {
      const modules = parseModules(getRequestURL(event).searchParams.get('modules'));
      const tools = narrowToolsByModule(await serveableTools(db), modules);
      return ok(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }

    // ── Tool execution ───────────────────────────────────────────────────────
    case 'tools/call': {
      const p = params as { name?: string; arguments?: Record<string, unknown> };
      // A tool whose capability is declined is dropped from the served set, so it
      // is "Unknown tool" here too — same answer the list gives. `?modules=` only
      // narrows the advertised list, so it does not block a call.
      const tool = await serveableTool(db, p?.name);
      if (!tool) {
        return rpcErr(id, RPC.INVALID_PARAMS, `Unknown tool: ${p?.name}`);
      }

      const args = p?.arguments ?? {};
      try {
        const data = await tool.handler(db, args, ctx);
        return ok(id, toContent(data));
      } catch (err) {
        // A tool that throws surfaces as a tool result with `isError: true`, not
        // a JSON-RPC protocol error: the latter is a transport-level failure that
        // clients render as a broken connection, while the former is a message the
        // model reads and recovers from (bad argument, missing entity, no access).
        const message = err instanceof Error ? err.message : String(err);
        return ok(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
      }
    }

    // ── Prompts ──────────────────────────────────────────────────────────────
    case 'prompts/list': {
      return ok(id, {
        prompts: MCP_PROMPT_DEFS.map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments ?? [],
        })),
      });
    }

    case 'prompts/get': {
      const p = params as { name?: string; arguments?: Record<string, string> };
      if (!p?.name || !isKnownPrompt(p.name)) {
        return rpcErr(id, RPC.INVALID_PARAMS, `Unknown prompt: ${p?.name}`);
      }
      // The URL the client used to reach this dashboard is the URL its reporter
      // should point at; PIWI_SITE_URL overrides it when set (reverse proxy).
      const requestUrl = getRequestURL(event);
      const siteUrl = (useRuntimeConfig(event).public as { siteUrl?: string })?.siteUrl;
      const baseUrl = resolvePublicBaseUrl(siteUrl, `${requestUrl.protocol}//${requestUrl.host}`);
      const result = await getPrompt(p.name, {
        db,
        ctx,
        baseUrl,
        authEnabled: isAuthEnabled(event),
        args: p.arguments ?? {},
      });
      return ok(id, result);
    }

    // ── Resources (not implemented) ──────────────────────────────────────────
    case 'resources/list':
      return ok(id, { resources: [] });

    default:
      return rpcErr(id, RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}
