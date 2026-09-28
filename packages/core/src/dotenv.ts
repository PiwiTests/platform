/**
 * The `.env` file `piwi init` writes, read the way the Piwi command line and
 * editors read it: `KEY=value` lines, optional `export `, single or double
 * quotes, `#` comments. No variable expansion.
 */

/** The variables of a `.env` file; later lines win. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let value = m[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out[m[1]!] = value;
  }
  return out;
}

/** How a Piwi client reaches an instance. */
export interface PiwiConnection {
  serverUrl: string;
  apiKey: string | null;
  project: string;
}

/**
 * The connection from the first source that names an instance URL, in order:
 * explicit values (flags), the environment, the workspace `.env`, then the
 * desktop app's discovery file (`{ url, token }`). The project falls through
 * the same order. The API key comes only from where the URL came from, so a
 * key never reaches a URL someone else chose: the person's own flags and
 * environment (flags first) pair with each other, a workspace `.env` only with
 * itself, and the desktop app's token serves only its own URL. Null when no
 * source names a URL.
 */
export function resolvePiwiConnection(sources: {
  flags?: { serverUrl?: string; apiKey?: string; project?: string };
  env?: Record<string, string | undefined>;
  dotEnv?: Record<string, string>;
  desktop?: { url: string; token: string } | null;
}): PiwiConnection | null {
  const own = {
    serverUrl: sources.flags?.serverUrl || sources.env?.PIWI_DASHBOARD_URL,
    apiKey: sources.flags?.apiKey || sources.env?.PIWI_API_KEY,
  };
  const workspace = { serverUrl: sources.dotEnv?.PIWI_DASHBOARD_URL, apiKey: sources.dotEnv?.PIWI_API_KEY };
  const project = sources.flags?.project || sources.env?.PIWI_PROJECT_NAME || sources.dotEnv?.PIWI_PROJECT_NAME || '';
  const desktop = sources.desktop ?? null;
  const trim = (url: string) => url.replace(/\/+$/, '');
  const layer = own.serverUrl ? own : workspace.serverUrl ? workspace : null;
  const serverUrl = layer ? trim(layer.serverUrl!) : desktop ? trim(desktop.url) : '';
  if (!serverUrl) return null;
  const desktopKey = desktop && trim(desktop.url) === serverUrl ? desktop.token : null;
  return { serverUrl, apiKey: layer?.apiKey || desktopKey || null, project };
}
