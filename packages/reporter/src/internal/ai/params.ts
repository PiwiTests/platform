/**
 * Parameters are first-class: a template like `row for {name}` is the cache key,
 * so one entry serves every value. Placeholders survive compilation as `{{name}}`
 * markers inside locator args and step values; replay substitutes the runtime
 * value locally. Param values are masked out of any snapshot sent to the model,
 * so secrets never leave the machine.
 */
import type { LocatorArg } from './artifact.js';

/**
 * Extract the placeholder names from a template string literal at the type level,
 * so a missing or misspelled parameter is a compile error. Placeholder names are
 * assumed brace-free (`{email}`, not `{a{b}}`).
 */
export type ExtractParams<S extends string> = S extends `${string}{${infer Param}}${infer Rest}`
  ? Param | ExtractParams<Rest>
  : never;

/**
 * The parameter argument list for a template: no argument when the template has
 * no placeholders, otherwise a required record of every placeholder → string.
 */
export type ParamArgs<S extends string> = [ExtractParams<S>] extends [never]
  ? []
  : [params: Record<ExtractParams<S>, string>];

/** A plain runtime bag of parameter values. */
export type ParamValues = Record<string, string>;

const PLACEHOLDER = /\{([^{}]+)\}/g;
const MARKER = /\{\{([^{}]+)\}\}/g;

/** The distinct placeholder names in a template, in first-appearance order. */
export function extractPlaceholders(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Turn a placeholder name into its compiled marker form. */
export function marker(name: string): string {
  return `{{${name}}}`;
}

/**
 * Runtime guard mirroring the compile-time types (for JS callers and dynamic
 * values): every placeholder must have a defined value. Throws otherwise.
 */
export function validateParams(template: string, params: ParamValues | undefined): void {
  const placeholders = extractPlaceholders(template);
  if (placeholders.length === 0) return;
  const missing = placeholders.filter((name) => params?.[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`piwi AI: template "${template}" is missing parameter(s): ${missing.join(', ')}`);
  }
}

/** Replace `{{name}}` markers in a string with runtime parameter values. */
export function substituteMarkers(text: string, params: ParamValues): string {
  return text.replace(MARKER, (whole, name: string) => {
    const value = params[name.trim()];
    return value === undefined ? whole : value;
  });
}

/** Deep-substitute `{{name}}` markers across a locator's argument array. */
export function substituteArgs(args: readonly LocatorArg[], params: ParamValues): LocatorArg[] {
  return args.map((arg) => substituteValue(arg, params));
}

function substituteValue(value: LocatorArg, params: ParamValues): LocatorArg {
  if (typeof value === 'string') return substituteMarkers(value, params);
  if (Array.isArray(value)) return value.map((v) => substituteValue(v, params));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, LocatorArg> = {};
    for (const [key, v] of Object.entries(value)) out[key] = substituteValue(v, params);
    return out;
  }
  return value;
}

/**
 * Mask parameter values out of outbound text (an ARIA snapshot sent to the
 * model) by replacing each value with its marker. Longest values first so a
 * value that contains another is masked whole. Only non-empty values mask.
 */
export function maskValues(text: string, params: ParamValues): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  let masked = text;
  for (const [name, value] of entries) {
    masked = masked.split(value).join(marker(name));
  }
  return masked;
}

/**
 * Parametricity check: every placeholder must actually appear as a marker
 * somewhere in the compiled locator/value text. A grounding that pinned a
 * concrete value positionally instead of parametrically is rejected, never
 * cached — otherwise the "one entry per template" guarantee would silently break.
 */
export function isParametric(template: string, compiledText: string): boolean {
  return extractPlaceholders(template).every((name) => compiledText.includes(marker(name)));
}
