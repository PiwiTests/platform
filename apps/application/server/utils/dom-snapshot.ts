/**
 * Failure-time DOM snapshot resolution over stored traces. The pure rendering
 * (`renderSnapshotHtml`/`extractDomSnapshot`) lives in the node-free
 * `dom-snapshot-render.ts` so the browser demo can reuse it; this module wires
 * it to node-only trace loading (storage + zlib via `trace-parser.ts`). No
 * re-exports: Nitro auto-imports every server/utils export, and duplicates
 * would shadow each other — import the pure API from `dom-snapshot-render.ts`
 * directly.
 */
import { getStorage } from '../storage';
import { parseZip, type ZipEntry } from './trace-zip';
import { decodeResource } from './resource-compression';
import { parseTraceTexts, parseResourceSnapshots, traceFileRank, type TraceResource } from './trace-events';
import {
  DOM_SNAPSHOT_CAP_CHARS,
  extractDomSnapshot,
  collectStylesheetLinks,
  inlineStylesheets,
  collectCssUrls,
  inlineCssUrls,
  maskCssText,
  type DomSnapshotResult,
  type DomSnapshotSource,
} from './dom-snapshot-render';
// The ARIA-snapshot fallback renderer lives in its own node-free module so the
// browser demo can reuse it (the trace path above pulls in node-only zlib).
import { renderAriaSnapshotHtml } from './dom-snapshot-aria';

// Budgets — a broken app can ship huge bundles, and base64 inflates by a third,
// so cap both the text and the embedded binary.
const MAX_STYLESHEET_BYTES = 1_000_000; // per external stylesheet
const INLINE_ASSET_BUDGET = 2_500_000; // total raw bytes embedded as data: URIs across the snapshot
const MAX_ASSET_BYTES = 512_000; // per font/image
const INLINE_STYLES_MAX_CHARS = 8_000_000; // ceiling on total inlined CSS text (incl. data: URIs)

/** File-extension → MIME fallback when the trace didn't record a usable Content-Type. */
const EXT_MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
};

/** Resolve a `<link href>` / CSS `url(...)` (possibly relative) against a base URL. */
function resolveResourceUrl(href: string, base: string | undefined): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * The MIME type to stamp on a `data:` URI for a captured asset: the recorded
 * Content-Type when it's a real type, else inferred from the stored file's or
 * the reference's extension. Null when nothing plausible is known — the caller
 * then leaves the reference alone rather than emit a mis-typed data URI.
 */
function assetMimeType(res: TraceResource, ref: string): string | null {
  const recorded = res.mimeType?.split(';')[0]?.trim();
  if (recorded && recorded.includes('/') && !/x-unknown|octet-stream/i.test(recorded)) return recorded;
  const ext = (
    /\.([a-z0-9]+)(?:[?#]|$)/i.exec(res.sha1)?.[1] ?? /\.([a-z0-9]+)(?:[?#]|$)/i.exec(ref)?.[1]
  )?.toLowerCase();
  return (ext && EXT_MIME[ext]) || null;
}

/**
 * Embed a stylesheet's own `url(...)` assets (fonts, background images) as
 * base64 `data:` URIs so they render in the offline, opaque-origin iframe. Each
 * ref resolves against the stylesheet's URL (not the document's), then the same
 * resource lookup the stylesheets use. Shares one binary budget across the whole
 * snapshot. Returns the CSS with resolvable refs rewritten; the rest untouched.
 */
async function inlineCssAssets(
  css: string,
  styleBaseUrl: string,
  urlToRes: Map<string, TraceResource>,
  resourcesDir: string,
  budget: { value: number },
): Promise<string> {
  if (budget.value <= 0) return css;
  const refs = collectCssUrls(css);
  if (refs.length === 0) return css;
  const storage = getStorage();
  const replacements: Record<string, string> = {};
  for (const ref of refs) {
    if (budget.value <= 0) break;
    const abs = resolveResourceUrl(ref, styleBaseUrl);
    const res = (abs ? urlToRes.get(abs) : undefined) ?? urlToRes.get(ref);
    if (!res) continue;
    const mime = assetMimeType(res, ref);
    if (!mime) continue;
    try {
      const bytes = decodeResource(await storage.readFile(`${resourcesDir}/${res.sha1}`));
      if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES || bytes.length > budget.value) continue;
      replacements[ref] = `data:${mime};base64,${bytes.toString('base64')}`;
      budget.value -= bytes.length;
    } catch {
      // Missing/unreadable asset — leave the url() as-is.
    }
  }
  return Object.keys(replacements).length ? inlineCssUrls(css, replacements) : css;
}

/**
 * Inline the snapshot's external stylesheets from the trace's stored resources.
 * Maps each `<link href>` → absolute URL (via the frame's base) → content hash
 * (from the `.network` stream) → the CSS body stored under the project's
 * `trace-resources` pool. Purely additive: any missing piece leaves the `<link>`
 * untouched, so a page with unreachable CSS is no worse off than before.
 */
async function inlineTraceStylesheets(
  blobPath: string,
  entries: ZipEntry[],
  result: DomSnapshotResult,
): Promise<DomSnapshotResult> {
  if (result.status !== 'ok' || !result.html) return result;
  const hrefs = collectStylesheetLinks(result.html);
  if (hrefs.length === 0) return result;

  const networkTexts = entries.filter((e) => e.name.endsWith('.network')).map((e) => e.data.toString('utf8'));
  const urlToRes = parseResourceSnapshots(networkTexts);
  if (urlToRes.size === 0) return result;

  // Resources live in a project-scoped shared pool; the id is in the blob path
  // (`project-<id>/blobs/<hash>.zip`).
  const projectId = /^project-(\d+)\//.exec(blobPath)?.[1];
  if (!projectId) return result;
  const resourcesDir = `project-${projectId}/trace-resources`;
  const storage = getStorage();

  const cssByHref: Record<string, string> = {};
  const assetBudget = { value: INLINE_ASSET_BUDGET };
  for (const href of hrefs) {
    const abs = resolveResourceUrl(href, result.frameUrl);
    const res = (abs ? urlToRes.get(abs) : undefined) ?? urlToRes.get(href);
    if (!res) continue;
    try {
      const bytes = decodeResource(await storage.readFile(`${resourcesDir}/${res.sha1}`));
      if (bytes.length === 0 || bytes.length > MAX_STYLESHEET_BYTES) continue;
      // Embed the sheet's own url() assets first, THEN mask token-shaped secrets
      // — masking last leaves the fresh base64 data URIs (and this sheet's
      // content-hashed filenames) intact. url() refs resolve against the
      // stylesheet's own URL, not the document's.
      const css = await inlineCssAssets(bytes.toString('utf8'), abs ?? href, urlToRes, resourcesDir, assetBudget);
      cssByHref[href] = maskCssText(css);
    } catch {
      // Resource missing/unreadable — leave the <link> as-is.
    }
  }
  if (Object.keys(cssByHref).length === 0) return result;
  return { ...result, html: inlineStylesheets(result.html, cssByHref, INLINE_STYLES_MAX_CHARS) };
}

/** Options for {@link getTraceDomSnapshot}. */
export interface TraceDomSnapshotOptions {
  /** Inline external stylesheets from the trace's resources (the interactive picker only). */
  inlineStyles?: boolean;
}

/** `extractDomSnapshot` over a stored (slim) trace blob, optionally inlining external CSS. */
export async function getTraceDomSnapshot(
  blobPath: string,
  capChars: number,
  options: TraceDomSnapshotOptions = {},
): Promise<DomSnapshotResult> {
  let entries: ZipEntry[];
  try {
    const data = await getStorage().readFile(blobPath);
    entries = await parseZip(data);
  } catch {
    return { status: 'no-trace' };
  }
  const traceTexts = entries
    .filter((e) => e.name.endsWith('.trace'))
    .sort((a, b) => traceFileRank(a.name) - traceFileRank(b.name))
    .map((e) => e.data.toString('utf8'));
  if (traceTexts.length === 0) return { status: 'no-trace' };

  const result = extractDomSnapshot(parseTraceTexts(traceTexts), capChars);
  if (!options.inlineStyles) return result;
  try {
    return await inlineTraceStylesheets(blobPath, entries, result);
  } catch {
    // Inlining is best-effort decoration — never fail the snapshot over it.
    return result;
  }
}

/** Options for {@link resolveCaseDomSnapshot}. */
export interface ResolveCaseDomSnapshotOptions {
  /**
   * Which representation to render. Defaults to `dom` (trace-derived) when a
   * trace exists, falling back to `aria`. Pass `aria` to force the ARIA tree
   * even when a trace is available (the view toggle).
   */
  source?: DomSnapshotSource;
  /**
   * Inline external stylesheets from the trace so the snapshot renders styled.
   * Only the interactive picker requests this — the read-only DOM card shows the
   * HTML as text, where inlined bundles would just be noise.
   */
  inlineStyles?: boolean;
}

/**
 * Resolve the failure-time snapshot for a case. By default it prefers the
 * trace-derived DOM and falls back to the ARIA tree, but `source: 'aria'`
 * forces the ARIA tree even when a trace exists. The result reports which
 * representation it is (`source`) and every representation available for the
 * case (`availableSources`) so the UI can offer a view toggle. Shared by the
 * dom-snapshot endpoint and the interactive locator picker.
 */
export async function resolveCaseDomSnapshot(
  traceBlobPath: string | null | undefined,
  ariaSnapshot: string | null | undefined,
  capChars: number = DOM_SNAPSHOT_CAP_CHARS,
  options: ResolveCaseDomSnapshotOptions = {},
): Promise<DomSnapshotResult> {
  // Render the ARIA tree up front (cheap) so we can both offer it as a toggle
  // and serve it directly without parsing the trace when it's the one requested.
  const ariaHtml = ariaSnapshot ? renderAriaSnapshotHtml(ariaSnapshot) : null;
  let domAvailable = !!traceBlobPath;
  const ariaAvailable = !!ariaHtml;

  const sources = (): DomSnapshotSource[] => {
    const list: DomSnapshotSource[] = [];
    if (domAvailable) list.push('dom');
    if (ariaAvailable) list.push('aria');
    return list;
  };
  const asAria = (): DomSnapshotResult => ({
    status: 'ok',
    html: ariaHtml!,
    truncated: false,
    snapshotName: 'aria-fallback',
    source: 'aria',
    availableSources: sources(),
  });

  // Explicit ARIA request — skip the trace entirely.
  if (options.source === 'aria' && ariaHtml) return asAria();

  if (traceBlobPath) {
    const result = await getTraceDomSnapshot(traceBlobPath, capChars, { inlineStyles: options.inlineStyles });
    if (result.status === 'ok' && result.html) {
      return { ...result, source: 'dom', availableSources: sources() };
    }
    // The trace produced no usable DOM — drop it as an option and fall back.
    domAvailable = false;
  }
  if (ariaHtml) return asAria();
  return { status: 'no-trace', availableSources: sources() };
}
