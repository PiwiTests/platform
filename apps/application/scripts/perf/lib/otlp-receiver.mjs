/**
 * A minimal OpenTelemetry collector for the suite: it accepts the OTLP/HTTP
 * JSON the servers export (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) and keeps the
 * spans by trace, so each response's `Server-Timing: traceparent` leads to the
 * SQL statements that request ran — and, for a page, to the requests the server
 * made to itself while rendering it.
 */
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';

const SPAN_KIND_INTERNAL = 1;

function attributeValue(value) {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('boolValue' in value) return value.boolValue;
  return undefined;
}

/** The trace id named by a `Server-Timing` header's `traceparent` entry, if any. */
export function traceIdFromServerTiming(header) {
  const match = /traceparent;desc="?00-([0-9a-f]{32})-/.exec(header ?? '');
  return match?.[1] ?? null;
}

export async function startOtlpReceiver() {
  const spansByTrace = new Map();
  let received = 0;

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/traces')) {
        res.writeHead(404).end();
        return;
      }
      if (!String(req.headers['content-type'] ?? '').includes('json')) {
        res.writeHead(415).end('OTLP/HTTP JSON only');
        return;
      }
      try {
        let body = Buffer.concat(chunks);
        if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
        const payload = JSON.parse(body.toString('utf8'));
        for (const rs of payload.resourceSpans ?? []) {
          for (const ss of rs.scopeSpans ?? []) {
            for (const span of ss.spans ?? []) {
              const attrs = Object.fromEntries((span.attributes ?? []).map((a) => [a.key, attributeValue(a.value)]));
              const entry = {
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId || null,
                name: span.name,
                kind: span.kind,
                ms: Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1e6,
                statement: attrs['db.statement'] ?? attrs['db.query.text'] ?? null,
              };
              if (!spansByTrace.has(entry.traceId)) spansByTrace.set(entry.traceId, []);
              spansByTrace.get(entry.traceId).push(entry);
              received++;
            }
          }
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      } catch (error) {
        res.writeHead(400).end(String(error));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  return {
    endpoint: `http://127.0.0.1:${port}/v1/traces`,
    received: () => received,
    /**
     * The SQL a request ran: every statement span of its trace, grouped by
     * statement text, and the requests the server made to itself while
     * serving it, each with its own count.
     */
    requestSql(traceId) {
      const spans = spansByTrace.get(traceId);
      if (!spans) return null;
      const byId = new Map(spans.map((s) => [s.spanId, s]));
      const nestedRequestOf = (span) => {
        for (let p = byId.get(span.parentSpanId); p; p = byId.get(p.parentSpanId)) {
          if (p.kind === SPAN_KIND_INTERNAL && p.statement == null && /^[A-Z]+ \//.test(p.name)) return p.name;
        }
        return null;
      };
      const queries = new Map();
      const nested = new Map();
      let statements = 0;
      let ms = 0;
      for (const span of spans) {
        if (span.statement == null) continue;
        statements++;
        ms += span.ms;
        const q = queries.get(span.statement) ?? { query: span.statement, calls: 0, ms: 0 };
        q.calls++;
        q.ms += span.ms;
        queries.set(span.statement, q);
        const via = nestedRequestOf(span);
        if (via) nested.set(via, (nested.get(via) ?? 0) + 1);
      }
      return {
        statements,
        ms,
        queries: [...queries.values()].sort((a, b) => b.calls - a.calls || b.ms - a.ms),
        nested: [...nested.entries()]
          .map(([request, n]) => ({ request, statements: n }))
          .sort((a, b) => b.statements - a.statements),
      };
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
