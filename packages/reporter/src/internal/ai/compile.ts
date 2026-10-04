/**
 * Turn a resolved element into a committed locator — deterministically. The
 * model's only job is to point at an element (a ref); the `@piwitests/core`
 * scorer ranks the ways to address it and this module freezes the top stable,
 * flat candidate into structured data plus a drift fingerprint. Same page + same
 * element ⇒ same artifact, regardless of model sampling.
 */
import type { AriaCandidate, ElementFingerprint, RankedLocator } from '@piwitests/core';
import { freshLocatorsFromCandidate } from '@piwitests/core';
import type { LocatorArg, StructuredLocator } from './artifact.js';

/** A compiled locator plus the fingerprint used to detect later drift. */
export interface CompiledLocator {
  locator: StructuredLocator;
  fingerprint: ElementFingerprint;
  score: number;
}

/** Anchored-chain candidates carry `anchor*` arg keys we don't flatten (yet). */
function hasAnchor(args: Record<string, unknown>): boolean {
  return Object.keys(args).some((key) => key.startsWith('anchor'));
}

/** Map a ranked candidate's structured args to positional Playwright arguments. */
function positionalArgs(method: string, args: Record<string, unknown>): LocatorArg[] | null {
  switch (method) {
    case 'getByTestId':
      return typeof args.testId === 'string' ? [args.testId] : null;
    case 'getByRole': {
      if (typeof args.role !== 'string') return null;
      const options: Record<string, LocatorArg> = {};
      if (typeof args.name === 'string') options.name = args.name;
      if (typeof args.level === 'number') options.level = args.level;
      return Object.keys(options).length > 0 ? [args.role, options] : [args.role];
    }
    case 'getByLabel':
      return typeof args.label === 'string' ? [args.label] : null;
    case 'getByPlaceholder':
      return typeof args.placeholder === 'string' ? [args.placeholder] : null;
    case 'getByText':
    case 'getByAltText':
      return typeof args.text === 'string' ? [args.text] : null;
    case 'getByTitle':
      return typeof args.title === 'string' ? [args.title] : null;
    case 'locator':
      return typeof args.selector === 'string' ? [args.selector] : null;
    default:
      return null;
  }
}

/** Convert one flat ranked candidate to a structured locator, or null if anchored. */
export function rankedToStructured(ranked: RankedLocator): StructuredLocator | null {
  if (hasAnchor(ranked.args)) return null;
  const args = positionalArgs(ranked.method, ranked.args);
  if (!args) return null;
  return { method: ranked.method, args };
}

/**
 * Compile a locator from an ARIA candidate (role + accessible name + level) — the
 * form the authoring model points at. `@piwitests/core` generates the ranked
 * semantic locators; the top flat one is committed. Returns `null` when the
 * candidate has no usable name to address it by.
 */
export function compileFromCandidate(candidate: AriaCandidate): CompiledLocator | null {
  const fingerprint: ElementFingerprint = { role: candidate.role, name: candidate.name };
  if (candidate.level != null) fingerprint.level = candidate.level;
  for (const ranked of freshLocatorsFromCandidate(candidate)) {
    const structured = rankedToStructured(ranked);
    if (structured) return { locator: structured, fingerprint, score: ranked.score };
  }
  return null;
}
