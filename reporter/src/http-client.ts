import https from 'https';
import http from 'http';
import { URL } from 'url';
import FormData from 'form-data';

export { FormData };

/**
 * Low-level HTTP client for communicating with the Piwi Dashboard server.
 * Supports JSON requests, multipart form-data uploads, and session-based login.
 */
export class HttpClient {
  private serverUrl: string;
  private verbose: boolean;

  /**
   * @param serverUrl Base URL of the Piwi Dashboard server (e.g. `http://localhost:3000`).
   * @param verbose   Enable verbose console logging for debugging.
   */
  constructor(serverUrl: string, verbose?: boolean) {
    this.serverUrl = serverUrl;
    this.verbose = verbose ?? false;
  }

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
      console.log(`[Piwi Dashboard] Authenticating as ${options.username}...`);
      return this.login(options.username, options.password);
    }
    return null;
  }

  /** Authenticate with username/password and return the session cookie string */
  async login(username: string, password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/auth/login', this.serverUrl);
      const transport = url.protocol === 'https:' ? https : http;
      const postData = JSON.stringify({ username, password });

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const setCookie = res.headers['set-cookie'];
              if (!setCookie || setCookie.length === 0) {
                reject(new Error('Login succeeded but no session cookie was returned'));
                return;
              }
              const cookie = setCookie.map((c: string) => c.split(';')[0]).join('; ');
              if (this.verbose) console.log('[Piwi Dashboard] Logged in successfully');
              resolve(cookie);
            } else {
              if (this.verbose) console.error(`[Piwi Dashboard] Login response: ${data}`);
              reject(new Error(`Login failed with status ${res.statusCode}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  /** Send a JSON POST request. `auth` can be an API key (prefix `pd_`) or a session cookie string. */
  async postJSON(pathname: string, payload: unknown, auth?: string | null): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(pathname, this.serverUrl);
      const transport = url.protocol === 'https:' ? https : http;
      const postData = JSON.stringify(payload);

      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      };

      this.applyAuth(headers, auth);

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve({});
              }
            } else {
              if (this.verbose) console.error(`[Piwi Dashboard] Response: ${data}`);
              reject(new Error(`Request failed with status ${res.statusCode}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  /** Send a multipart form-data POST request. Used for report and trace uploads. */
  async postFormData(pathname: string, form: FormData, auth?: string | null): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(pathname, this.serverUrl);
      const transport = url.protocol === 'https:' ? https : http;

      const headers = form.getHeaders() as Record<string, string>;
      this.applyAuth(headers, auth);

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve({});
              }
            } else {
              reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
            }
          });
        },
      );

      req.on('error', reject);
      form.pipe(req);
    });
  }

  private applyAuth(headers: Record<string, any>, auth?: string | null): void {
    if (!auth) return;
    if (auth.startsWith('pd_')) {
      headers['Authorization'] = `Bearer ${auth}`;
    } else {
      headers['Cookie'] = auth;
    }
  }
}
