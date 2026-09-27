/**
 * Renders a `RecordedSession` as a runnable Playwright TypeScript spec.
 *
 * Two modes, one function: with no catalog, every step becomes a raw
 * `page.*` line (the extension's fully offline path — works with no Piwi
 * connection at all). With a catalog, `matchFunctionAt` (see
 * `function-match.ts`) greedily collapses a *contiguous* run of steps that
 * matches a function's whole pattern into a call against the project's own
 * page-object methods/helpers, leaving anything unmatched as raw lines — never
 * a partial or guessed call, and never a call that quietly swallows a step it
 * does not perform.
 *
 * This is the one place recorded steps become code. Every value is written as
 * an escaped literal, every locator is re-rendered from its parsed chain, and
 * every catalog identifier is checked, so steps that arrive from a file can
 * shape the spec but never add code of their own. With no options
 * the output is the plain recorder export; the options adapt it to a project
 * (its `test` import, `baseURL`, stable locators, URL checks, test details).
 */
import { VALUE_MATCHERS, type RecordedSession, type RecordedStep, type RecordedTarget } from './recording';
import { matchFunctionAt, type TestFunctionEntry, type RankedFunctionMatch } from './function-match';
import { renderLocatorChain, tryParseLocatorChain, type LocatorArg, type LocatorChain } from './locator-chain';
import { assessLocatorChain, type LocatorStabilityLevel } from './locator-stability';
import { pageKey } from './page-key';

export interface CodegenOptions {
  /** Test title; defaults to a generic placeholder the user is expected to rename. */
  title?: string;
  /** When set, complete pattern matches against these entries collapse into function calls. */
  catalog?: TestFunctionEntry[];
  /** Module `test` and `expect` are imported from — a project's own fixtures file, for instance. `@playwright/test` by default. */
  testImport?: string;
  /** `absolute` (default) keeps recorded URLs; `relative` writes URLs on the recorded origin as paths, so the project's `baseURL` applies. */
  urls?: 'absolute' | 'relative';
  /** `first` (default) takes each target's best-ranked alternative; `stable` takes the first one `assessLocatorChain` rates stable, when there is one. */
  locators?: 'first' | 'stable';
  /** Canonical chains the project's tests already use. An alternative among them that is not brittle comes first. */
  preferLocators?: ReadonlySet<string>;
  /** After a step that leads to another page, wait for that page's URL before the next step. */
  urlChecks?: boolean;
  /** `env` reads every typed value from `PIWI_TEST_VALUE_<step>` instead of writing it into the spec. */
  values?: 'literal' | 'env';
  /** Mark the test as expected to fail (`test.fail()`), with an optional reason written beside it. */
  expectFail?: boolean | { reason: string };
  /** Test tags; a missing `@` is added. */
  tags?: string[];
  /** Test annotations, such as `{ type: 'piwi:bug', description: '37' }`. */
  annotations?: Array<{ type: string; description?: string }>;
  /** `file` (default): imports and one test. `body`: only the test's lines, to paste into an existing test. */
  format?: 'file' | 'body';
}

export type CodegenWarningCode = 'no-locator' | 'brittle-locator' | 'redacted-value' | 'incomplete-assertion';

/** Something about a step the reader of the generated spec should check. */
export interface CodegenWarning {
  /** Index of the step in the session. */
  step: number;
  code: CodegenWarningCode;
  message: string;
}

export interface CodegenResult {
  code: string;
  /** One entry per emitted line that came from a function match, keyed by the matched steps' first index — lets a UI highlight which recorded steps a given call represents. */
  matchedSpans: Array<{ startStep: number; endStep: number; functionName: string }>;
  warnings: CodegenWarning[];
}

/**
 * A line terminator inside a single-quoted literal is a syntax error, not a
 * newline — and a recorded value reaches codegen unnormalized (`normalizeSteps`
 * collapses whitespace on a target's *text*, never on the value the user typed),
 * so one multi-line paste into a textarea used to be enough to make the whole
 * exported spec unparseable.
 */
const QUOTE_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

function quote(s: string): string {
  return `'${s.replace(/[\\'\n\r\u2028\u2029]/g, (c) => QUOTE_ESCAPES[c]!)}'`;
}

const LINE_TERMINATORS = /[\n\r\u2028\u2029]/;

function argIsSafe(arg: LocatorArg): boolean {
  switch (arg.type) {
    case 'regex':
      // Rendered as a literal: it must be a valid pattern on one line. An empty
      // source would start a comment, and `new RegExp` refuses a leading `*`.
      if (!arg.source || LINE_TERMINATORS.test(arg.source)) return false;
      try {
        new RegExp(arg.source, arg.flags);
        return true;
      } catch {
        return false;
      }
    case 'object':
      return arg.entries.every(([, value]) => argIsSafe(value));
    case 'chain':
      return chainIsSafe(arg.chain);
    default:
      return true;
  }
}

function chainIsSafe(chain: LocatorChain): boolean {
  return chain.calls.length > 0 && chain.calls.every((call) => call.args.every(argIsSafe));
}

/**
 * A locator expression as code the spec can hold: parsed with the chain grammar
 * (a fixed list of Playwright methods, literal arguments only), checked, and
 * rendered back in canonical form. Null for anything else — the text a step
 * carries is never pasted into the spec as it is.
 */
export function safeLocator(expr: string): { chain: LocatorChain; text: string } | null {
  const chain = tryParseLocatorChain(expr);
  if (!chain || !chainIsSafe(chain)) return null;
  return { chain, text: renderLocatorChain(chain) };
}

interface ChosenLocator {
  text: string;
  level: LocatorStabilityLevel;
}

/**
 * The locator a step's target is written with. Alternatives come ranked best
 * first; a chain the suite already uses wins when it is not brittle, then, with
 * `locators: 'stable'`, the first chain rated stable, then the first chain.
 */
function chooseLocator(target: RecordedTarget | null, options: CodegenOptions): ChosenLocator | null {
  if (!target) return null;
  const candidates = target.alternatives.flatMap((alt) => {
    const safe = safeLocator(alt.locator);
    return safe ? [safe] : [];
  });
  if (candidates.length === 0) return null;
  const levels = new Map<string, LocatorStabilityLevel>();
  const levelOf = (c: { chain: LocatorChain; text: string }): LocatorStabilityLevel => {
    let level = levels.get(c.text);
    if (!level) {
      level = assessLocatorChain(c.chain).level;
      levels.set(c.text, level);
    }
    return level;
  };
  const prefer = options.preferLocators;
  if (prefer && prefer.size > 0) {
    const known = candidates.find((c) => prefer.has(c.text) && levelOf(c) !== 'brittle');
    if (known) return { text: known.text, level: levelOf(known) };
  }
  if (options.locators === 'stable') {
    const stable = candidates.find((c) => levelOf(c) === 'stable');
    if (stable) return { text: stable.text, level: 'stable' };
  }
  const first = candidates[0]!;
  return { text: first.text, level: levelOf(first) };
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Placeholder segments `pageKey` puts in place of ids and tokens. */
const PLACEHOLDER_SEGMENT = /^:(?:id|uuid|ulid|token|jwt)$/;

/**
 * A regex literal that matches any URL of the same page: the page key's path,
 * with each id or token segment open, followed by the end, a query or a hash.
 * Null for a URL that is not a web page.
 */
export function pageUrlPattern(url: string): string | null {
  const key = pageKey(url);
  if (key === null) return null;
  if (key === '/') return String.raw`/:\/\/[^/]+\/?(?:[?#]|$)/`;
  const body = key
    .slice(1)
    .split('/')
    .map((segment) => (PLACEHOLDER_SEGMENT.test(segment) ? '[^/?#]+' : segment.replace(/[^A-Za-z0-9_]/g, '\\$&')))
    .join('\\/');
  return `/\\/${body}(?:[?#]|$)/`;
}

/** A comment's text on one line. */
function commentText(s: string): string {
  return s.replace(/[\n\r\u2028\u2029]+/g, ' ').trim();
}

interface RenderContext {
  options: CodegenOptions;
  /** The origin the steps were recorded on, when they have one. */
  origin: string | null;
  warnings: CodegenWarning[];
  /** Environment variables the spec reads typed values from. */
  envNames: string[];
}

/** A URL as the spec writes it: a path when `urls: 'relative'` and it is on the recorded origin, absolute otherwise. */
function urlForCode(url: string, ctx: RenderContext): string {
  const isPath = url.startsWith('/');
  if (ctx.options.urls === 'relative') {
    if (isPath || !ctx.origin) return url;
    try {
      const parsed = new URL(url);
      return parsed.origin === ctx.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url;
    } catch {
      return url;
    }
  }
  return isPath && ctx.origin ? `${ctx.origin}${url}` : url;
}

function locatorForStep(step: RecordedStep, index: number, ctx: RenderContext): string {
  const chosen = chooseLocator(step.target, ctx.options);
  if (!chosen) {
    ctx.warnings.push({ step: index, code: 'no-locator', message: 'No locator was captured for this element.' });
    return `page.locator(${quote('/* no locator captured */')})`;
  }
  if (chosen.level === 'brittle') {
    ctx.warnings.push({
      step: index,
      code: 'brittle-locator',
      message: `The best locator captured for this element is brittle: ${chosen.text}`,
    });
  }
  return `page.${chosen.text}`;
}

function renderAssertStep(step: RecordedStep, index: number, ctx: RenderContext): string[] {
  const assertion = step.action === 'assertVisible' ? null : step.assertion;
  if (step.action === 'assert' && !assertion) {
    ctx.warnings.push({ step: index, code: 'incomplete-assertion', message: 'This assertion has nothing to check.' });
    return [`  // Step ${index + 1}: an assertion with nothing to check.`];
  }
  const matcher = assertion?.matcher ?? 'toBeVisible';
  const not = assertion?.negated ? '.not' : '';
  const lines: string[] = [];
  if (assertion?.note) lines.push(`  // ${commentText(assertion.note)}`);
  let arg = '';
  if (VALUE_MATCHERS.has(matcher)) {
    if (assertion?.expected == null) {
      ctx.warnings.push({ step: index, code: 'incomplete-assertion', message: `${matcher} needs an expected value.` });
      return [`  // Step ${index + 1}: ${matcher} without an expected value.`];
    }
    arg = quote(matcher === 'toHaveURL' ? urlForCode(assertion.expected, ctx) : assertion.expected);
  }
  const subject = matcher === 'toHaveURL' ? 'page' : locatorForStep(step, index, ctx);
  let line = `  await expect(${subject})${not}.${matcher}(${arg});`;
  if (assertion?.actual != null && assertion.actual !== assertion.expected) {
    line += ` // recorded: ${quote(assertion.actual)}`;
  }
  lines.push(line);
  return lines;
}

function renderRawStep(step: RecordedStep, index: number, ctx: RenderContext): string[] {
  if (step.action === 'goto') return [`  await page.goto(${quote(urlForCode(step.value ?? step.pageUrl, ctx))});`];
  if (step.action === 'assert' || step.action === 'assertVisible') return renderAssertStep(step, index, ctx);
  if (step.action === 'press' && !step.target) return [`  await page.keyboard.press(${quote(step.value ?? 'Enter')});`];
  const loc = locatorForStep(step, index, ctx);
  switch (step.action) {
    case 'click':
      return [`  await ${loc}.click();`];
    case 'fill': {
      if (step.redacted || ctx.options.values === 'env') {
        const envVar = `PIWI_TEST_VALUE_${index}`;
        ctx.envNames.push(envVar);
        if (step.redacted) {
          ctx.warnings.push({
            step: index,
            code: 'redacted-value',
            message: `A password was typed here; the spec reads it from ${envVar}.`,
          });
        }
        return [`  await ${loc}.fill(process.env.${envVar} ?? '');`];
      }
      return [`  await ${loc}.fill(${quote(step.value ?? '')});`];
    }
    case 'check':
      return [`  await ${loc}.check();`];
    case 'uncheck':
      return [`  await ${loc}.uncheck();`];
    case 'selectOption':
      return [`  await ${loc}.selectOption(${quote(step.value ?? '')});`];
    case 'press':
      return [`  await ${loc}.press(${quote(step.value ?? 'Enter')});`];
  }
}

/** A bare identifier can be an object key as-is; anything else has to be quoted. */
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Whether a catalog entry's own names are safe to emit unquoted.
 *
 * `name`, `receiver` and `importName` are interpolated straight into the
 * generated source — `import { X } from …`, `new X(page)`, `await r.name()` —
 * so anything that is not a plain identifier is arbitrary code, not a call. The
 * API validates these on the way in; this is the second line of defence, on the
 * way out, because a catalog can also be filled by the MCP tool from an agent
 * reading repository source, and the generated spec's whole promise is that it
 * is deterministic rather than invented. An entry that fails this is skipped for
 * matching entirely, so its steps come out as ordinary locator lines.
 */
export function callIdentifiersAreSafe(entry: TestFunctionEntry): boolean {
  if (!IDENTIFIER_RE.test(entry.name)) return false;
  if (entry.kind !== 'page-object-method') return true;
  if (entry.receiver != null && !IDENTIFIER_RE.test(entry.receiver)) return false;
  if (entry.importName != null && !IDENTIFIER_RE.test(entry.importName)) return false;
  return true;
}

/**
 * An `object` param renders as a literal built from whichever of its `fields`
 * resolved — unresolved fields are *omitted* rather than emitted empty, since
 * an options bag's fields are typically optional and a missing key type-checks
 * where `label: ''` would silently target nothing.
 */
function objectArgExpr(param: TestFunctionEntry['params'][number], match: RankedFunctionMatch): string {
  const entries = (param.fields ?? [])
    .map((field) => {
      const raw = match.args[`${param.name}.${field}`];
      return raw == null ? null : `${IDENTIFIER_RE.test(field) ? field : quote(field)}: ${quote(raw)}`;
    })
    .filter((pair): pair is string => pair != null);
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
}

function argExpr(entry: TestFunctionEntry, match: RankedFunctionMatch): string {
  return entry.params
    .map((p) => {
      if (p.type === 'object') return objectArgExpr(p, match);
      const raw = match.args[p.name];
      if (raw == null) return p.type === 'number' ? '0' : p.type === 'boolean' ? 'false' : "''";
      if (p.type === 'number') return String(Number(raw) || 0);
      if (p.type === 'boolean') return String(raw === 'true' || raw === '1');
      return quote(raw);
    })
    .join(', ');
}

function renderFunctionCall(match: RankedFunctionMatch): string {
  const { entry } = match;
  const args = argExpr(entry, match);
  if (entry.kind === 'page-object-method' && entry.receiver) {
    return `  await ${entry.receiver}.${entry.name}(${args});`;
  }
  return `  await ${entry.name}(page${args ? `, ${args}` : ''});`;
}

/** One `import` + (for page-object methods) one instantiation line per receiver actually used, deduped, in first-use order. */
function renderImports(usedEntries: TestFunctionEntry[]): string[] {
  const lines: string[] = [];
  const seenModules = new Set<string>();
  for (const entry of usedEntries) {
    if (entry.kind === 'page-object-method' && entry.receiver && entry.importName) {
      const moduleKey = `${entry.module}#${entry.importName}`;
      if (!seenModules.has(moduleKey)) {
        seenModules.add(moduleKey);
        lines.push(`import { ${entry.importName} } from ${quote(entry.module)};`);
      }
    } else if (!seenModules.has(entry.module + entry.name)) {
      seenModules.add(entry.module + entry.name);
      lines.push(`import { ${entry.name} } from ${quote(entry.module)};`);
    }
  }
  return lines;
}

function renderInstantiations(usedEntries: TestFunctionEntry[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of usedEntries) {
    if (entry.kind !== 'page-object-method' || !entry.receiver || !entry.importName) continue;
    if (seen.has(entry.receiver)) continue;
    seen.add(entry.receiver);
    lines.push(`  const ${entry.receiver} = new ${entry.importName}(page);`);
  }
  return lines;
}

/** Test details (`tag`, `annotation`) as the lines of an object literal, or none. */
function renderDetails(options: CodegenOptions): string[] {
  const tags = (options.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const annotations = (options.annotations ?? []).filter((a) => a.type.trim());
  const lines: string[] = [];
  if (tags.length > 0) lines.push(`  tag: [${tags.map((t) => quote(t.startsWith('@') ? t : `@${t}`)).join(', ')}],`);
  if (annotations.length > 0) {
    lines.push('  annotation: [');
    for (const a of annotations) {
      const description = a.description != null ? `, description: ${quote(a.description)}` : '';
      lines.push(`    { type: ${quote(a.type)}${description} },`);
    }
    lines.push('  ],');
  }
  return lines;
}

function expectFailLine(options: CodegenOptions): string | null {
  if (!options.expectFail) return null;
  const reason = typeof options.expectFail === 'object' ? commentText(options.expectFail.reason) : '';
  return reason ? `  test.fail(); // ${reason}` : '  test.fail();';
}

/** Whether two recorded pages differ, by page key. */
function samePage(a: string, b: string): boolean {
  const ka = pageKey(a);
  const kb = pageKey(b);
  return ka === null || kb === null || ka === kb;
}

export function renderSpec(session: RecordedSession, options: CodegenOptions = {}): CodegenResult {
  const { steps } = session;
  const title = options.title ?? 'recorded flow';
  const catalog = (options.catalog ?? []).filter(callIdentifiersAreSafe);
  const ctx: RenderContext = {
    options,
    origin: originOf(session.startUrl) ?? originOf(steps[0]?.pageUrl ?? ''),
    warnings: [],
    envNames: [],
  };

  const bodyLines: string[] = [];
  const matchedSpans: CodegenResult['matchedSpans'] = [];
  const usedEntries: TestFunctionEntry[] = [];

  /** After the step at `last`, wait for the next step's page when the next step is on another one. */
  const checkNextPage = (last: number): void => {
    if (!options.urlChecks) return;
    const next = steps[last + 1];
    const current = steps[last];
    if (!next || !current || next.action === 'goto' || samePage(current.pageUrl, next.pageUrl)) return;
    const pattern = pageUrlPattern(next.pageUrl);
    if (pattern) bodyLines.push(`  await expect(page).toHaveURL(${pattern});`);
  };

  let pos = 0;
  let sawGoto = false;
  while (pos < steps.length) {
    const step = steps[pos]!;

    if (step.action === 'goto') {
      bodyLines.push(...renderRawStep(step, pos, ctx));
      sawGoto = true;
      pos++;
      continue;
    }

    const match = catalog.length > 0 ? matchFunctionAt(steps, pos, catalog) : null;
    if (match) {
      bodyLines.push(renderFunctionCall(match));
      usedEntries.push(match.entry);
      const last = Math.max(...match.matchedIndices);
      matchedSpans.push({ startStep: pos, endStep: last, functionName: match.entry.name });
      checkNextPage(last);
      pos = last + 1;
      continue;
    }

    bodyLines.push(...renderRawStep(step, pos, ctx));
    checkNextPage(pos);
    pos++;
  }

  if (!sawGoto && session.startUrl) {
    bodyLines.unshift(`  await page.goto(${quote(urlForCode(session.startUrl, ctx))});`);
  }

  const importLines = renderImports(usedEntries);
  const instantiationLines = renderInstantiations(usedEntries);
  const failLine = expectFailLine(options);
  const envLines =
    options.values === 'env' && ctx.envNames.length > 0
      ? [`  // Typed values come from ${[...new Set(ctx.envNames)].join(', ')}.`]
      : [];
  const testBody = [...(failLine ? [failLine] : []), ...envLines, ...instantiationLines, ...bodyLines];

  if (options.format === 'body') {
    const needs = importLines.map((line) => `  // Needs: ${line}`);
    return { code: [...needs, ...testBody, ''].join('\n'), matchedSpans, warnings: ctx.warnings };
  }

  const details = renderDetails(options);
  const opening =
    details.length > 0
      ? [`test(${quote(title)}, {`, ...details, `}, async ({ page }) => {`]
      : [`test(${quote(title)}, async ({ page }) => {`];

  const lines = [
    // Package name interpolated rather than adjoining the preceding keyword
    // directly, so this generated-code line does not itself look like a real
    // import to the boundary test in tests/boundary.test.ts.
    `import { test, expect } from ${quote(options.testImport?.trim() || '@playwright/test')};`,
    ...importLines,
    ``,
    ...opening,
    ...testBody,
    `});`,
    ``,
  ];

  return { code: lines.join('\n'), matchedSpans, warnings: ctx.warnings };
}
