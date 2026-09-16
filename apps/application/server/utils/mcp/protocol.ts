// Latest protocol version this server implements. On `initialize` we echo the
// client's requested version when it's one we support, otherwise we reply with
// this. Kept broad so older clients (2024-11-05) keep working.
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

/** `serverInfo` for the `initialize` response — the version is the running app's version. */
export function mcpServerInfo(appVersion: string) {
  return { name: 'piwi-dashboard', version: appVersion };
}

/** Pick the protocol version to advertise: the client's if supported, else ours. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function ok<T>(id: string | number | null | undefined, result: T): JsonRpcResponse<T> {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function rpcErr(id: string | number | null | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}
