/**
 * A human title for a failure cluster that has no AI-generated one.
 *
 * The cluster's signature is the masked first error line — a Playwright error
 * kind with placeholders (`Timeout <N>ms exceeded.`), which reads as a message
 * shape, not a problem. This builds a name from what the cluster knows: the
 * error kind, the locator it targets, the route a navigation was heading for,
 * and the spec file it hit, e.g. `Timeout on getByLabel('Email address') in
 * checkout.spec.ts`. Mask tokens never reach the title.
 */
import { extractTopFrameFile } from '#shared/error-fingerprint';

export interface DescribableCluster {
  /** AI-generated title; wins when present. */
  title?: string | null;
  /** Masked first error line. */
  signature: string;
  errorType?: string | null;
  /** Locator extracted from the error, unmasked. */
  selector?: string | null;
  /** One raw error kept on the cluster — supplies the top stack frame and the navigation URL. */
  sampleError?: string | null;
  /** Spec file of a representative affected test, used when the sample error has no frame. */
  filePath?: string | null;
}

const MASK_TOKEN_RE = /<(?:N|VALUE|URL|STR|UUID|HASH|EMAIL)>/g;
const NAVIGATION_RE =
  /\b(?:page|frame)\.(?:goto|waitForURL|waitForNavigation|reload|goBack|goForward)\b|navigating to\b/i;
const URL_RE = /https?:\/\/[^\s'"`)]+/;
const MATCHER_RE = /\.(?:not\.)?(to[A-Z]\w*)\b/;
const STATE_MATCHER_RE =
  /^toBe(?:Visible|Hidden|Enabled|Disabled|Checked|Attached|Detached|Editable|Focused|InViewport|Empty|OK)$|^toPass$/;
const ERROR_CLASS_RE = /^([A-Z]\w*(?:Error|Exception))\b/;
const LOCATOR_TARGET_RE = /^(\w+)\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\/(?:[^/\\]|\\.)+\/[a-z]*)/;

/** The spec basename (`checkout.spec.ts`) from a path, or null. */
function specBasename(path: string | null | undefined): string | null {
  if (!path) return null;
  const file = path
    .replace(/\\/g, '/')
    .replace(/:\d+(?::\d+)?$/, '')
    .split('/')
    .pop();
  return file || null;
}

/**
 * The locator's primary target without its option object, so per-row values
 * (`{ name: 'Acme' }`) never end up naming a cluster that spans every row:
 * `getByRole('row', { name: 'Acme' })` → `getByRole('row')`.
 */
function locatorTarget(selector: string | null | undefined): string | null {
  if (!selector) return null;
  const m = LOCATOR_TARGET_RE.exec(selector.trim());
  if (m) return `${m[1]}(${m[2]})`;
  const method = /^(\w+)\(/.exec(selector.trim());
  return method ? `${method[1]}(…)` : null;
}

/** The pathname of the first URL in the raw error, or null. */
function navigationRoute(sampleError: string | null | undefined): string | null {
  const m = sampleError ? URL_RE.exec(sampleError) : null;
  if (!m) return null;
  try {
    return new URL(m[0]).pathname || '/';
  } catch {
    return null;
  }
}

/** Human wording for an assertion matcher: `toHaveCount mismatch`, `toBeVisible failed`. */
function assertionKind(text: string): string {
  const matcher = MATCHER_RE.exec(text)?.[1];
  if (!matcher) return 'Assertion failed';
  return STATE_MATCHER_RE.test(matcher) ? `${matcher} failed` : `${matcher} mismatch`;
}

/** Deterministic title from the cluster's own fields — never the AI title. */
export function clusterFallbackTitle(cluster: DescribableCluster): string {
  const signature = cluster.signature ?? '';
  const raw = cluster.sampleError ?? '';
  const spec = specBasename(extractTopFrameFile(raw)) ?? specBasename(cluster.filePath);
  const inSpec = spec ? ` in ${spec}` : '';
  const target = locatorTarget(cluster.selector);
  const onTarget = target ? ` on ${target}` : '';
  const isNavigation = cluster.errorType === 'navigation' || NAVIGATION_RE.test(signature) || NAVIGATION_RE.test(raw);

  if (isNavigation) {
    const route = navigationRoute(raw);
    const kind = /timeout|timed out/i.test(signature) ? 'Navigation timeout' : 'Navigation failed';
    return `${kind}${route ? ` on ${route}` : ''}${inSpec}`;
  }

  switch (cluster.errorType) {
    case 'strict-mode':
      return `Strict-mode violation${onTarget}${inSpec}`;
    case 'assertion':
      return `${assertionKind(signature) === 'Assertion failed' ? assertionKind(raw) : assertionKind(signature)}${onTarget}${inSpec}`;
    case 'timeout': {
      if (/\bTest timeout\b/i.test(signature)) return `Test timeout${inSpec}`;
      const action = /\b(?:locator|page|frame|element)\.(\w+): /.exec(signature)?.[1];
      return `Timeout${onTarget || (action ? ` on ${action}` : '')}${inSpec}`;
    }
    case 'crash':
      return `${/Page crashed/i.test(signature) ? 'Page crashed' : 'Browser or page closed'}${inSpec}`;
    default: {
      const errorClass = ERROR_CLASS_RE.exec(signature)?.[1];
      if (errorClass) return `${errorClass}${onTarget}${inSpec}`;
      if (target) return `Error${onTarget}${inSpec}`;
      const cleaned = signature.replace(MASK_TOKEN_RE, '…').replace(/\s+/g, ' ').trim();
      const head = cleaned.length > 120 ? `${cleaned.slice(0, 119)}…` : cleaned;
      return head ? `${head}${inSpec}` : `Error${inSpec}`;
    }
  }
}

/** The name to show for a cluster: its AI title when it has one, else the deterministic title. */
export function describeCluster(cluster: DescribableCluster): string {
  const title = cluster.title?.trim();
  return title || clusterFallbackTitle(cluster);
}

/**
 * The secondary line under a cluster name — the raw signature — or null when
 * it would repeat the name.
 */
export function clusterSignatureLine(cluster: DescribableCluster): string | null {
  const name = describeCluster(cluster);
  return cluster.signature && cluster.signature !== name ? cluster.signature : null;
}

/** Concrete element states that a headline can carry but a deterministic name does not. */
const HEADLINE_STATE_PHRASES = [
  'not found',
  'not visible',
  'not enabled',
  'not editable',
  'not attached',
  'not stable',
];

/**
 * Whether the latest occurrence's headline adds a value the cluster name lacks —
 * an expected/received pair, a timeout duration, a "not found" / "not visible" /
 * "not enabled" state, or a count. Returns false when the name already says
 * everything (the headline differs only in wording or word order), so the page
 * can show the headline as a second line only when it is worth the room.
 */
export function headlineAddsValue(name: string, headline: string | null | undefined): boolean {
  const head = (headline ?? '').trim();
  if (!head) return false;
  const nameLc = name.toLowerCase();
  const headLc = head.toLowerCase();
  if (headLc === nameLc) return false;

  // A concrete state ("was not found on the page") the name does not carry.
  if (HEADLINE_STATE_PHRASES.some((p) => headLc.includes(p) && !nameLc.includes(p))) return true;

  // A number the name lacks — a count, an expected/received value, or a timeout
  // duration. Names carry no digits (spec line numbers are stripped), so a new
  // number in the headline is a value the name is missing.
  const nameNumbers = new Set(nameLc.match(/\d+/g) ?? []);
  const headlineNumbers = headLc.match(/\d+/g) ?? [];
  return headlineNumbers.some((n) => !nameNumbers.has(n));
}
