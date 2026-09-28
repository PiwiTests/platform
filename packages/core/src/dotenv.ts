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
 * desktop app's discovery file (`{ url, token }`). The API key and project
 * fall through the same order independently; the desktop app's token serves
 * only its own URL. Null when no source names a URL.
 */
export function resolvePiwiConnection(sources: {
  flags?: { serverUrl?: string; apiKey?: string; project?: string };
  env?: Record<string, string | undefined>;
  dotEnv?: Record<string, string>;
  desktop?: { url: string; token: string } | null;
}): PiwiConnection | null {
  const layers = [
    { serverUrl: sources.flags?.serverUrl, apiKey: sources.flags?.apiKey, project: sources.flags?.project },
    {
      serverUrl: sources.env?.PIWI_DASHBOARD_URL,
      apiKey: sources.env?.PIWI_API_KEY,
      project: sources.env?.PIWI_PROJECT_NAME,
    },
    {
      serverUrl: sources.dotEnv?.PIWI_DASHBOARD_URL,
      apiKey: sources.dotEnv?.PIWI_API_KEY,
      project: sources.dotEnv?.PIWI_PROJECT_NAME,
    },
  ];
  const first = (key: 'serverUrl' | 'apiKey' | 'project') => layers.map((l) => l[key]).find((v) => !!v) ?? null;
  const desktop = sources.desktop ?? null;
  const serverUrl = (first('serverUrl') ?? desktop?.url)?.replace(/\/+$/, '');
  if (!serverUrl) return null;
  const apiKey = first('apiKey') ?? (desktop && desktop.url.replace(/\/+$/, '') === serverUrl ? desktop.token : null);
  return { serverUrl, apiKey, project: first('project') ?? '' };
}
