import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import FormData from 'form-data';
import { Logger } from '../support/logger.js';

export { FormData };

/**
 * An HTTP response with a non-2xx status. Carries the numeric `status` so
 * callers can branch on a specific code (401, 404, 409, 422, …) via
 * `error instanceof HttpError && error.status === …` instead of sniffing the
 * message string.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string = `Request failed with status ${status}`,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Response from the unified `request()` core. */
interface HttpResponse {
  status: number;
  text: string;
  headers: http.IncomingHttpHeaders;
}

/** Options for the unified `request()` core. */
interface HttpRequestOptions {
  headers?: Record<string, string | number>;
  /** JSON body (written then the request is ended). Mutually exclusive with `form`. */
  body?: string;
  /** Multipart form (piped into the request). Mutually exclusive with `body`. */
  form?: FormData;
  auth?: string | null;
}

/**
 * Low-level HTTP client for communicating with the Piwi Dashboard server.
 * Supports JSON requests, multipart form-data uploads, and session-based login.
 *
 * All three public methods (`login`, `postJSON`, `postFormData`) delegate to a
 * single `request()` core that owns the transport selection, header/auth
 * application, response accumulation, and socket timeout. The package stays on
 * the single `form-data` runtime dependency — no HTTP client library.
 */
export class HttpClient {
  /**
   * @param serverUrl Base URL of the Piwi Dashboard server (e.g. `http://localhost:3000`).
   * @param logger    Prefixed logger for verbose diagnostics.
   * @param timeout   Socket inactivity timeout in ms (default 30s). A hung
   *                  server now fails fast instead of stalling the reporter.
   */
  constructor(
    private readonly serverUrl: string,
    private readonly logger: Logger = new Logger(),
    private readonly timeout = 30000,
  ) {}

  /**
   * Resolve an auth credential: prefer `apiKey`, fall back to `username`/`password` login,
   * or return `null` when neither is configured.
   */
  async resolveAuth(options: {
    apiKey?: string | null;
    username?: string | null;
    password?: string | null;
  }): Promise<string | null> {
    if (options.apiKey) return options.apiKey;
    if (options.username && options.password) {
      this.logger.info(`Authenticating as ${options.username}...`);
      return this.login(options.username, options.password);
    }
    return null;
  }

  /** Authenticate with username/password and return the session cookie string */
  async login(username: string, password: string): Promise<string> {
    const body = JSON.stringify({ username, password });
    const res = await this.request('POST', '/api/auth/login', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.debugError(`Login response: ${res.text}`);
      throw new HttpError(res.status, `Login failed with status ${res.status}`);
    }
    const setCookie = res.headers['set-cookie'];
    if (!setCookie || setCookie.length === 0) {
      throw new Error('Login succeeded but no session cookie was returned');
    }
    const cookie = setCookie.map((c: string) => c.split(';')[0]).join('; ');
    this.logger.debug('Logged in successfully');
    return cookie;
  }

  /** Send a JSON POST request. `auth` can be an API key (prefix `pd_`) or a session cookie string. */
  async postJSON(pathname: string, payload: unknown, auth?: string | null): Promise<any> {
    const body = JSON.stringify(payload);
    const res = await this.request('POST', pathname, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
      auth,
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.debugError(`Response: ${res.text}`);
      throw new HttpError(res.status);
    }
    try {
      return JSON.parse(res.text);
    } catch {
      return {};
    }
  }

  /** Send a multipart form-data POST request. Used for report and trace uploads. */
  async postFormData(pathname: string, form: FormData, auth?: string | null): Promise<any> {
    const headers = form.getHeaders() as Record<string, string>;
    const res = await this.request('POST', pathname, { headers, form, auth });
    if (res.status < 200 || res.status >= 300) {
      throw new HttpError(res.status, `Request failed with status ${res.status}: ${res.text}`);
    }
    try {
      return JSON.parse(res.text);
    } catch {
      return {};
    }
  }

  /** Unified request core: transport, headers, auth, response accumulation, timeout. */
  private request(method: string, pathname: string, opts: HttpRequestOptions): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(pathname, this.serverUrl);
      const transport = url.protocol === 'https:' ? https : http;
      const headers: Record<string, string | number> = { ...opts.headers };
      this.applyAuth(headers, opts.auth);

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method,
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, text: data, headers: res.headers });
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(this.timeout, () => {
        req.destroy(new Error(`Request to ${pathname} timed out after ${this.timeout}ms`));
      });

      if (opts.form) {
        opts.form.pipe(req);
      } else if (opts.body !== undefined) {
        req.write(opts.body);
        req.end();
      } else {
        req.end();
      }
    });
  }

  private applyAuth(headers: Record<string, string | number>, auth?: string | null): void {
    if (!auth) return;
    if (auth.startsWith('pd_')) {
      headers['Authorization'] = `Bearer ${auth}`;
    } else {
      headers['Cookie'] = auth;
    }
  }
}
