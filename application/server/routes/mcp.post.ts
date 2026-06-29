import { requireAuth } from '../utils/auth';
import { getDatabase } from '../database';
import { MCP_TOOLS, toContent } from '../utils/mcp/tools';
import { ok, rpcErr, RPC, MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from '../utils/mcp/protocol';
import type { JsonRpcRequest } from '../utils/mcp/protocol';

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

  // Authenticate using the same API-key / session mechanism as the REST API.
  await requireAuth(event);

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

  const responses = await Promise.all(requests.map((req) => handleRequest(event, req)));

  // Notifications (no id) have no response — filter them out.
  const toSend = responses.filter((r) => r !== null);

  setResponseHeader(event, 'Content-Type', 'application/json');
  return Array.isArray(body) ? toSend : (toSend[0] ?? null);
});

async function handleRequest(event: ReturnType<typeof createEvent> | any, req: JsonRpcRequest) {
  if (!req || req.jsonrpc !== '2.0' || !req.method) {
    return rpcErr(req?.id, RPC.INVALID_REQUEST, 'Invalid JSON-RPC request');
  }

  // Notifications (no id) — fire and forget
  if (req.id === undefined || req.id === null) {
    if (req.method === 'notifications/initialized') return null;
    return null;
  }

  try {
    return await dispatch(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[MCP] error handling', req.method, message);
    return rpcErr(req.id, RPC.INTERNAL_ERROR, message);
  }
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

async function dispatch(req: JsonRpcRequest) {
  const { id, method, params } = req;

  switch (method) {
    // ── Protocol handshake ──────────────────────────────────────────────────
    case 'initialize': {
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          'Piwi Dashboard MCP server. Provides tools to query Playwright test results, failure clusters, AI diagnoses, and SCM diffs. Start with list_projects to discover available projects.',
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
      const data = await tool.handler(db, args);
      return ok(id, toContent(data));
    }

    // ── Resources / prompts (not implemented in v1) ──────────────────────────
    case 'resources/list':
      return ok(id, { resources: [] });

    case 'prompts/list':
      return ok(id, { prompts: [] });

    default:
      return rpcErr(id, RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}
