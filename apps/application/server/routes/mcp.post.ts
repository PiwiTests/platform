import { getRequestURL, type H3Event } from 'h3';
import { requireAuth, isAuthEnabled } from '../utils/auth';
import { getDatabase } from '../database';
import { MCP_TOOLS, toContent } from '../utils/mcp/tools';
import type { McpContext } from '../utils/mcp/tools';
import { getPrompt, isKnownPrompt } from '../utils/mcp/prompts';
import { getProjectScope } from '../utils/project-access';
import { resolvePublicBaseUrl } from '../utils/oauth-helpers';
import { ok, rpcErr, RPC, mcpServerInfo, negotiateProtocolVersion } from '../utils/mcp/protocol';
import type { JsonRpcRequest } from '../utils/mcp/protocol';
import { MCP_PROMPT_DEFS } from '#shared/mcp-prompts';

const TOOL_MAP = new Map(MCP_TOOLS.map((t) => [t.name, t]));
const MAX_BODY_BYTES = 1_048_576; // 1 MB — reject oversized batches early

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

  const responses = await Promise.all(requests.map((req) => handleRequest(ctx, req, event)));

  // Notifications (no id) have no response — filter them out.
  const toSend = responses.filter((r) => r !== null);

  setResponseHeader(event, 'Content-Type', 'application/json');
  return Array.isArray(body) ? toSend : (toSend[0] ?? null);
});

async function handleRequest(ctx: McpContext, req: JsonRpcRequest, event: H3Event) {
  if (!req || req.jsonrpc !== '2.0' || !req.method) {
    return rpcErr(req?.id, RPC.INVALID_REQUEST, 'Invalid JSON-RPC request');
  }

  // Notifications (no id) — fire and forget
  if (req.id === undefined || req.id === null) {
    if (req.method === 'notifications/initialized') return null;
    return null;
  }

  try {
    return await dispatch(ctx, req, event);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[MCP] error handling', req.method, message);
    return rpcErr(req.id, RPC.INTERNAL_ERROR, message);
  }
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

async function dispatch(ctx: McpContext, req: JsonRpcRequest, event: H3Event) {
  const { id, method, params } = req;

  switch (method) {
    // ── Protocol handshake ──────────────────────────────────────────────────
    case 'initialize': {
      const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(requested),
        capabilities: { tools: {}, prompts: {} },
        serverInfo: mcpServerInfo(useRuntimeConfig(event).public.appVersion as string),
        instructions:
          'Piwi Dashboard MCP server — query Playwright test results, failure clusters, AI diagnoses, and SCM diffs. ' +
          'Start with list_projects to discover project IDs. ' +
          'List tools return {items, nextCursor}; pass nextCursor back (when non-null) to page. ' +
          'IDs: testCaseId = stable test identity; executionId/testRunsCaseId = one per-run execution. ' +
          'Errors are truncated; use get_test_run_case for full error text and explain_failure for a one-call evidence bundle. ' +
          'Write/triage tools (set_cluster_status, run_cluster_diagnosis, set_cluster_base_commit, submit_diagnosis_feedback) require reporter or admin access. ' +
          'The setup_piwi prompt (prompts/get) generates a ready-to-run setup for a Playwright project not yet reporting here.',
      });
    }

    case 'ping': {
      return ok(id, {});
    }

    // ── Tool listing ─────────────────────────────────────────────────────────
    case 'tools/list': {
      return ok(id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }

    // ── Tool execution ───────────────────────────────────────────────────────
    case 'tools/call': {
      const p = params as { name?: string; arguments?: Record<string, unknown> };
      const tool = p?.name ? TOOL_MAP.get(p.name) : null;
      if (!tool) {
        return rpcErr(id, RPC.INVALID_PARAMS, `Unknown tool: ${p?.name}`);
      }

      const db = await getDatabase();
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
      const db = await getDatabase();
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
