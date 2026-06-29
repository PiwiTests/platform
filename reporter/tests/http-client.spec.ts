import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import { HttpClient } from '../src/internal/transport/http-client.js';
import { Logger } from '../src/internal/support/logger.js';

interface RecordedReq {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startServer(
  handler: (req: RecordedReq, res: http.ServerResponse) => void,
): { server: http.Server; url: string; requests: RecordedReq[] } {
  const requests: RecordedReq[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const rec: RecordedReq = { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body };
      requests.push(rec);
      handler(rec, res);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('no addr'));
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, requests });
    });
  });
}

function jsonRes(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

describe('HttpClient (against fake http.Server)', () => {
  describe('postJSON', () => {
    it('sends a JSON POST and parses the response', async () => {
      const { server, url, requests } = await startServer((req, res) => {
        expect(req.method).toBe('POST');
        expect(req.url).toBe('/api/echo');
        jsonRes(res, 200, { ok: true, echoed: JSON.parse(req.body) });
      });
      try {
        const client = new HttpClient(url, new Logger(false));
        const out = await client.postJSON('/api/echo', { hello: 'world' }, null);
        expect(out.ok).toBe(true);
        expect(out.echoed).toEqual({ hello: 'world' });
        expect(requests.length).toBe(1);
        expect(requests[0].headers['content-type']).toBe('application/json');
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('rejects with "Request failed with status N" on non-2xx', async () => {
      const { server, url } = await startServer((_req, res) => jsonRes(res, 404, { error: 'nope' }));
      try {
        const client = new HttpClient(url, new Logger(false));
        await expect(client.postJSON('/api/x', {}, null)).rejects.toThrow(/Request failed with status 404/);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('resolves to {} when the response body is not JSON', async () => {
      const { server, url } = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not json');
      });
      try {
        const client = new HttpClient(url, new Logger(false));
        const out = await client.postJSON('/api/x', {}, null);
        expect(out).toEqual({});
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('applies apiKey as Bearer header (pd_ prefix)', async () => {
      const { server, url, requests } = await startServer((_req, res) => jsonRes(res, 200, {}));
      try {
        const client = new HttpClient(url, new Logger(false));
        await client.postJSON('/api/x', {}, 'pd_secret123');
        expect(requests[0].headers['authorization']).toBe('Bearer pd_secret123');
        expect(requests[0].headers['cookie']).toBe(undefined);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('applies session cookie as Cookie header', async () => {
      const { server, url, requests } = await startServer((_req, res) => jsonRes(res, 200, {}));
      try {
        const client = new HttpClient(url, new Logger(false));
        await client.postJSON('/api/x', {}, 'session=abc; path=/');
        expect(requests[0].headers['cookie']).toBe('session=abc; path=/');
        expect(requests[0].headers['authorization']).toBe(undefined);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  });

  describe('login', () => {
    it('returns the session cookie on 200', async () => {
      const { server, url, requests } = await startServer((req, res) => {
        expect(JSON.parse(req.body)).toEqual({ username: 'u', password: 'p' });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': ['session=abc; Path=/', 'other=xyz; HttpOnly'],
        });
        res.end(JSON.stringify({ ok: true }));
      });
      try {
        const client = new HttpClient(url, new Logger(false));
        const cookie = await client.login('u', 'p');
        expect(cookie).toBe('session=abc; other=xyz');
        expect(requests[0].url).toBe('/api/auth/login');
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('rejects when no set-cookie header is returned', async () => {
      const { server, url } = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      try {
        const client = new HttpClient(url, new Logger(false));
        await expect(client.login('u', 'p')).rejects.toThrow(/no session cookie/);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('rejects with "Login failed with status N" on non-2xx', async () => {
      const { server, url } = await startServer((_req, res) => jsonRes(res, 401, { error: 'bad' }));
      try {
        const client = new HttpClient(url, new Logger(false));
        await expect(client.login('u', 'p')).rejects.toThrow(/Login failed with status 401/);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  });

  describe('resolveAuth', () => {
    it('returns apiKey directly when set', async () => {
      const { server, url, requests } = await startServer((_req, res) => jsonRes(res, 200, {}));
      try {
        const client = new HttpClient(url, new Logger(false));
        const auth = await client.resolveAuth({ apiKey: 'pd_key', username: 'u', password: 'p' });
        expect(auth).toBe('pd_key');
        expect(requests.length).toBe(0); // no login call
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('returns null when neither apiKey nor username/password configured', async () => {
      const { server, url } = await startServer((_req, res) => jsonRes(res, 200, {}));
      try {
        const client = new HttpClient(url, new Logger(false));
        const auth = await client.resolveAuth({ apiKey: null, username: null, password: null });
        expect(auth).toBe(null);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it('logs in when username/password provided', async () => {
      const { server, url, requests } = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['sess=1; Path=/'] });
        res.end('{}');
      });
      try {
        const client = new HttpClient(url, new Logger(false));
        const auth = await client.resolveAuth({ apiKey: null, username: 'u', password: 'p' });
        expect(auth).toBe('sess=1');
        expect(requests[0].url).toBe('/api/auth/login');
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  });

  describe('request timeout', () => {
    it('rejects when the server never responds within the timeout', async () => {
      // Server accepts the request but never responds (never calls res.end).
      const { server, url } = await startServer((_req, _res) => {
        // intentionally swallow the request and never respond
      });
      try {
        const client = new HttpClient(url, new Logger(false), 100);
        await expect(client.postJSON('/api/slow', {}, null)).rejects.toThrow(/timed out after 100ms/);
      } finally {
        // Drop the hung connection and stop accepting new ones.
        (server as any).closeAllConnections?.();
        server.close();
        await new Promise<void>((r) => server.on('close', () => r()));
      }
    });
  });
});
