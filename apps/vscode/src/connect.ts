/**
 * The instance's side of Piwi: Connect, with no VS Code API so it is tested
 * against a stub: whether the instance asks for a key, its projects, and the
 * browser sign-in (an RFC 8628 device authorization, the one Piwi Picker
 * uses), which hands over an API key created for this editor.
 */

export class InstanceError extends Error {
  constructor(readonly status: number) {
    super(`the instance answered ${status}`);
    this.name = 'InstanceError';
  }
}

export interface ProjectItem {
  id: number;
  name: string;
}

export interface SignIn {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds between polls. */
  interval: number;
  /** Seconds until the request expires. */
  expiresIn: number;
}

export type SignInResult = { status: 'approved'; apiKey: string } | { status: 'denied' } | { status: 'expired' };

/** An instance URL as it is stored: trimmed, without trailing slashes; null when it is not an http(s) URL. */
export function normalizeServerUrl(input: string | null | undefined): string | null {
  const url = (input ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+\S*$/.test(url) ? url : null;
}

/**
 * The secret-storage entry of an instance's API key. The key is kept per instance: the
 * workspace settings, which a repository may commit, never select another instance's key.
 */
export function apiKeySecret(serverUrl: string): string {
  return `${API_KEY_SECRET_PREFIX}${normalizeServerUrl(serverUrl) ?? serverUrl.trim()}`;
}

export const API_KEY_SECRET_PREFIX = 'piwi.apiKey ';

async function send<T>(base: string, path: string, init: { apiKey?: string | null; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: {
      ...(init.apiKey ? { 'X-API-Key': init.apiKey } : {}),
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new InstanceError(response.status);
  return (await response.json()) as T;
}

export async function listProjects(base: string, apiKey: string | null): Promise<ProjectItem[]> {
  return (await send<{ items?: ProjectItem[] }>(base, '/api/projects/menu', { apiKey })).items ?? [];
}

/** Whether the instance asks for a key: it lists its projects to anyone when authentication is off. */
export async function needsKey(base: string): Promise<boolean> {
  try {
    await listProjects(base, null);
    return false;
  } catch (e) {
    if (e instanceof InstanceError && (e.status === 401 || e.status === 403)) return true;
    throw e;
  }
}

/** Start a sign-in; `editor` and `os` name the key the instance creates ("Piwi in Visual Studio Code on macOS"). */
export async function startSignIn(base: string, client: { editor: string; os: string }): Promise<SignIn> {
  const started = await send<SignIn>(base, '/api/extension/connect', { body: client });
  if (!normalizeServerUrl(started.verificationUrl)) throw new Error('the instance answered no sign-in page');
  return started;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Poll until the user allows or denies the request in the browser, it expires, or `signal` aborts. */
export async function waitForSignIn(
  base: string,
  started: SignIn,
  signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = sleep,
): Promise<SignInResult> {
  let interval = Math.min(Math.max(started.interval, 1), 60);
  const deadline = Date.now() + started.expiresIn * 1000;
  while (Date.now() < deadline) {
    await wait(interval * 1000, signal);
    const polled = await send<{ status: string; interval?: number; apiKey?: string }>(
      base,
      '/api/extension/connect/token',
      { body: { deviceCode: started.deviceCode } },
    );
    if (polled.status === 'slow_down') interval = Math.min(Math.max(polled.interval ?? interval + 5, 1), 60);
    else if (polled.status === 'approved') return { status: 'approved', apiKey: polled.apiKey ?? '' };
    else if (polled.status === 'denied') return { status: 'denied' };
    else if (polled.status !== 'pending') return { status: 'expired' };
  }
  return { status: 'expired' };
}
