/**
 * The `checkBaseUrl` check, run by the global setup before any worker starts:
 * every `baseURL` the run's projects use must answer. Any HTTP answer counts,
 * a redirect or a 404 included, except a 502, 503 or 504, which a gateway
 * sends when the app behind it is down. The request goes through Playwright's
 * own request context with the project's `ignoreHTTPSErrors` and `proxy`, so
 * it reaches the app the way the tests do.
 */
import { errorMessage } from './errors.js';

/** How many times a base URL is tried before it counts as down. */
export const BASE_URL_CHECK_ATTEMPTS = 3;
/** How long one attempt waits for an answer. */
export const BASE_URL_CHECK_TIMEOUT_MS = 10_000;
/** The pause between two attempts. */
export const BASE_URL_CHECK_DELAY_MS = 2_000;

const GATEWAY_ANSWERS: Record<number, string> = {
  502: 'bad gateway',
  503: 'service unavailable',
  504: 'gateway timeout',
};

interface ProjectLike {
  name?: string;
  dependencies?: string[];
  use?: { baseURL?: unknown; ignoreHTTPSErrors?: unknown; proxy?: unknown };
}

/** The part of Playwright's `FullConfig` the check reads. */
export interface BaseUrlConfig {
  projects?: ProjectLike[];
  use?: ProjectLike['use'];
}

type Proxy = { server: string; bypass?: string; username?: string; password?: string };

/** One base URL to check, with the request options of the projects that use it. */
export interface BaseUrlTarget {
  url: string;
  /** The names of the projects that use it. */
  projects: string[];
  ignoreHTTPSErrors: boolean;
  proxy?: Proxy;
}

/**
 * The project names `--project` selects on a Playwright command line, or null
 * when it selects none and every project runs. A bare `--project` takes the
 * arguments after it up to the next option, as Playwright's command line does.
 */
export function cliProjectNames(argv: string[] = process.argv): string[] | null {
  let names: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--project=')) {
      (names ??= []).push(arg.slice('--project='.length));
    } else if (arg === '--project') {
      names ??= [];
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) names.push(argv[++i]!);
    }
  }
  return names;
}

function wildcard(pattern: string): RegExp {
  const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`, 'i');
}

/**
 * The projects the run selects: the ones `--project` names (case-insensitive,
 * `*` as a wildcard) and, unless `--no-deps` is given, the projects they
 * depend on; every project when `--project` is absent.
 */
export function selectedProjects<T extends ProjectLike>(projects: T[], argv: string[] = process.argv): T[] {
  const names = cliProjectNames(argv);
  if (!names || names.length === 0) return projects;
  const patterns = names.map(wildcard);
  const chosen = new Set(projects.filter((p) => patterns.some((re) => re.test(p.name ?? ''))));
  if (!argv.includes('--no-deps')) {
    const byName = new Map(projects.map((p) => [p.name ?? '', p]));
    const queue = [...chosen];
    while (queue.length > 0) {
      for (const dep of queue.shift()!.dependencies ?? []) {
        const project = byName.get(dep);
        if (project && !chosen.has(project)) {
          chosen.add(project);
          queue.push(project);
        }
      }
    }
  }
  return projects.filter((p) => chosen.has(p));
}

function asProxy(value: unknown): Proxy | undefined {
  const proxy = value as Proxy | undefined;
  return proxy && typeof proxy === 'object' && typeof proxy.server === 'string' ? proxy : undefined;
}

/** The distinct base URLs of the projects the run selects, each with the projects that use it. */
export function baseUrlTargets(config: BaseUrlConfig, argv: string[] = process.argv): BaseUrlTarget[] {
  const projects: ProjectLike[] = config.projects?.length ? config.projects : [{ name: '', use: config.use }];
  const targets = new Map<string, BaseUrlTarget>();
  for (const project of selectedProjects(projects, argv)) {
    const url = project.use?.baseURL;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    const target = targets.get(url);
    if (target) {
      if (project.name) target.projects.push(project.name);
      continue;
    }
    targets.set(url, {
      url,
      projects: project.name ? [project.name] : [],
      ignoreHTTPSErrors: project.use?.ignoreHTTPSErrors === true,
      proxy: asProxy(project.use?.proxy),
    });
  }
  return [...targets.values()];
}

/** What one request to a base URL got: a status, or the error that stopped it. */
export type ProbeOutcome = { status: number } | { error: string };

/** Sends one request; the default goes through Playwright's request context. */
export type BaseUrlProbe = (target: BaseUrlTarget, timeoutMs: number) => Promise<ProbeOutcome>;

/** The first line of a Playwright request error, without its `apiRequestContext.get:` prefix. */
function requestError(error: unknown): string {
  const first = errorMessage(error).split('\n')[0]!.trim();
  return first.replace(/^apiRequestContext\.\w+:\s*/, '');
}

const playwrightProbe: BaseUrlProbe = async (target, timeoutMs) => {
  const { request } = await import('@playwright/test');
  const context = await request.newContext({ ignoreHTTPSErrors: target.ignoreHTTPSErrors, proxy: target.proxy });
  try {
    const response = await context.get(target.url, { timeout: timeoutMs, maxRedirects: 0, failOnStatusCode: false });
    return { status: response.status() };
  } catch (error) {
    return { error: requestError(error) };
  } finally {
    await context.dispose().catch(() => {});
  }
};

export interface BaseUrlCheckOptions {
  attempts?: number;
  timeoutMs?: number;
  delayMs?: number;
  probe?: BaseUrlProbe;
}

/** Why a base URL counts as down, or null when it answered. */
export async function checkBaseUrl(target: BaseUrlTarget, options: BaseUrlCheckOptions = {}): Promise<string | null> {
  const attempts = Math.max(1, options.attempts ?? BASE_URL_CHECK_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? BASE_URL_CHECK_TIMEOUT_MS;
  const delayMs = options.delayMs ?? BASE_URL_CHECK_DELAY_MS;
  const probe = options.probe ?? playwrightProbe;
  let reason = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const outcome = await probe(target, timeoutMs);
    if ('status' in outcome) {
      const gateway = GATEWAY_ANSWERS[outcome.status];
      if (!gateway) return null;
      reason = `${outcome.status} ${gateway}`;
    } else {
      reason = outcome.error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return `${reason} (${attempts} ${attempts === 1 ? 'attempt' : 'attempts'})`;
}

/**
 * Check every base URL the run's projects use, all at once. Throws an error
 * naming each one that did not answer, so Playwright stops before any worker
 * starts; resolves when there is nothing to check or every one answered.
 */
export async function checkBaseUrls(
  config: BaseUrlConfig,
  options: BaseUrlCheckOptions & { argv?: string[] } = {},
): Promise<BaseUrlTarget[]> {
  const targets = baseUrlTargets(config, options.argv);
  const reasons = await Promise.all(targets.map((target) => checkBaseUrl(target, options)));
  const down = targets.flatMap((target, i) => (reasons[i] ? [{ target, reason: reasons[i]! }] : []));
  if (down.length === 0) return targets;
  const lines = down.map(({ target, reason }) => {
    const used = target.projects.length > 0 ? ` (${target.projects.join(', ')})` : '';
    return `  ${target.url}${used}: ${reason}`;
  });
  const message = [
    `[Piwi Dashboard] The app under test did not answer, so no test ran:`,
    ...lines,
    `Bring the environment back and run again, or set checkBaseUrl: false (PIWI_CHECK_BASE_URL=false) to run the tests anyway.`,
  ].join('\n');
  const error = new Error(message);
  // Playwright prints the stack of a failed global setup; the message says everything.
  error.stack = message;
  throw error;
}
