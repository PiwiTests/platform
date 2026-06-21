import * as http from 'http';

export interface RecordedReq {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  raw: http.IncomingMessage;
}

export interface FakeServer {
  server: http.Server;
  url: string;
  requests: RecordedReq[];
  close: () => Promise<void>;
}

export type RouteHandler = (req: RecordedReq, res: http.ServerResponse) => void;

/**
 * Start a fake HTTP server that records every request. The `handler` is called
 * for each request; route on `req.url`. Use `jsonRes` to write JSON responses.
 */
export function startServer(handler: RouteHandler): FakeServer {
  const requests: RecordedReq[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const rec: RecordedReq = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body,
        raw: req,
      };
      requests.push(rec);
      handler(rec, res);
    });
  });
  return new Promise<FakeServer>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('no addr'));
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
        requests,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

export function jsonRes(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

export function textRes(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export function urlsHit(server: FakeServer): string[] {
  return server.requests.map((r) => r.url);
}

// ── Minimal Playwright fakes ────────────────────────────────────────────────

/** A fake Playwright `Suite` with a `project()` and `allTests()`. */
export function fakeSuite(opts: { projectMetadata?: Record<string, unknown> } = {}): any {
  const project = {
    name: 'chromium',
    use: { browserName: 'chromium' },
    metadata: opts.projectMetadata,
  };
  const suite = {
    type: 'describe',
    title: '',
    parent: undefined,
    _parallelMode: 'default',
    _annotations: [],
    project: () => project,
    allTests: () => [],
  };
  return suite;
}

/** A fake Playwright `TestCase`. */
export function fakeTestCase(opts: {
  title?: string;
  file?: string;
  line?: number;
  column?: number;
  parent?: any;
  annotations?: any[];
}): any {
  return {
    title: opts.title ?? 'test',
    location: { file: opts.file ?? '/tmp/test.spec.ts', line: opts.line ?? 1, column: opts.column ?? 1 },
    parent: opts.parent ?? fakeSuite(),
    annotations: opts.annotations ?? [],
  };
}

/** A fake Playwright `TestResult`. */
export function fakeResult(opts: {
  status?: string;
  duration?: number;
  error?: Error | null;
  retry?: number;
  workerIndex?: number | null;
  startTime?: Date;
  attachments?: any[];
  steps?: any[];
}): any {
  return {
    status: opts.status ?? 'passed',
    duration: opts.duration ?? 10,
    error: opts.error ?? null,
    retry: opts.retry ?? 0,
    workerIndex: opts.workerIndex ?? 0,
    startTime: opts.startTime ?? new Date('2024-01-01T00:00:00.000Z'),
    attachments: opts.attachments ?? [],
    steps: opts.steps ?? [],
  };
}

/** A fake Playwright `FullConfig`. */
export function fakeConfig(opts: { version?: string; shard?: any; workers?: number; projects?: any[] } = {}): any {
  return {
    version: opts.version ?? '1.50.0',
    shard: opts.shard ?? null,
    workers: opts.workers ?? 4,
    projects: opts.projects ?? [],
    metadata: undefined,
    globalTimeout: undefined,
    fullyParallel: false,
  };
}
