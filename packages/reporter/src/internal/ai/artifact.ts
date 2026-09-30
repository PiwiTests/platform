/**
 * The committed AI-step artifact: the compiler output that replay executes with
 * zero LLM calls. An entry is plain data — a structured locator program plus a
 * postcondition oracle — never code. The interpreter validates every method and
 * action against the `@piwitests/core` allowlists before touching a page, so a
 * tampered or malformed file can never turn into arbitrary execution.
 *
 * Files are canonical: sorted keys, two-space indent, one trailing newline, and
 * no volatile metadata (timestamps, model names, token counts, digests). Two
 * logically identical entries serialize to identical bytes, so a re-resolution
 * that reaches the same conclusion leaves the working tree clean.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElementFingerprint } from '@piwitests/core';
import { LOCATOR_METHODS, ACTION_METHODS } from '../capture/locator-healing.js';

/** The current on-disk schema version. Bump only on a breaking layout change. */
export const ARTIFACT_VERSION = 1 as const;

/** A JSON-serializable Playwright argument value (no RegExp — canonical bytes). */
export type LocatorArg = string | number | boolean | null | LocatorArg[] | { [key: string]: LocatorArg };

/**
 * A locator expressed as data: an allowlisted builder method, its positional
 * Playwright arguments, and an optional chain of sub-locators applied to the
 * result (`page.getByRole('list').getByRole('listitem')`). Replayed by the
 * interpreter, never evaluated.
 */
export interface StructuredLocator {
  method: string;
  args: LocatorArg[];
  chain?: StructuredLocator[];
}

/** How a postcondition is asserted after a flow (the oracle, D4). */
type PostconditionAssert = 'visible' | 'hidden' | 'attached' | 'url';

export interface Postcondition {
  assert: PostconditionAssert;
  /** Present for `visible`/`hidden`/`attached`. */
  locator?: StructuredLocator;
  /** Present for `url` (may carry `{{param}}` markers). */
  url?: string;
}

/** One compiled step of a `piwiRun` flow. */
export interface RunStep {
  locator: StructuredLocator;
  action: string;
  /** Fill/press value — may carry `{{param}}` markers substituted at replay. */
  value?: string;
  /** Drift guard: the element's role/name at compile time. */
  fingerprint?: ElementFingerprint;
  /** A short existence probe that skips cleanly when the element is absent. */
  optional?: boolean;
  /**
   * URL glob of a network response to wait for after the action (an Ajax call the
   * action triggers). The wait is armed *before* the action fires, so it can never
   * miss a fast response. May carry `{{param}}` markers substituted at replay.
   */
  waitForResponse?: string;
}

export interface LocatorEntry {
  version: typeof ARTIFACT_VERSION;
  kind: 'locator';
  template: string;
  locator: StructuredLocator;
  fingerprint?: ElementFingerprint;
}

export interface RunEntry {
  version: typeof ARTIFACT_VERSION;
  kind: 'run';
  template: string;
  steps: RunStep[];
  postcondition: Postcondition;
}

export type AiEntry = LocatorEntry | RunEntry;

const LOCATOR_METHOD_SET = new Set(LOCATOR_METHODS);
const ACTION_METHOD_SET = new Set(ACTION_METHODS);
const POSTCONDITION_ASSERTS: ReadonlySet<PostconditionAssert> = new Set<PostconditionAssert>([
  'visible',
  'hidden',
  'attached',
  'url',
]);

// ── Canonical serialization ──────────────────────────────────────────────────

/**
 * Deep-sort object keys so identical logical content produces identical bytes.
 * Array order is meaningful (step order, chain order) and is preserved.
 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      // Drop `undefined` fields entirely so an absent optional never varies bytes.
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** Serialize an entry to its canonical on-disk form (sorted keys, trailing newline). */
export function serializeEntry(entry: AiEntry): string {
  return `${JSON.stringify(sortDeep(entry), null, 2)}\n`;
}

// ── Validation ───────────────────────────────────────────────────────────────

class ArtifactError extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ArtifactError(message);
}

function validateStructuredLocator(value: unknown, where: string): asserts value is StructuredLocator {
  assert(value !== null && typeof value === 'object', `${where}: locator must be an object`);
  const loc = value as Record<string, unknown>;
  assert(typeof loc.method === 'string', `${where}: locator.method must be a string`);
  assert(LOCATOR_METHOD_SET.has(loc.method), `${where}: locator method "${String(loc.method)}" is not allowlisted`);
  assert(Array.isArray(loc.args), `${where}: locator.args must be an array`);
  if (loc.chain !== undefined) {
    assert(Array.isArray(loc.chain), `${where}: locator.chain must be an array`);
    loc.chain.forEach((child, i) => validateStructuredLocator(child, `${where}.chain[${i}]`));
  }
}

function validateRunStep(value: unknown, where: string): asserts value is RunStep {
  assert(value !== null && typeof value === 'object', `${where}: step must be an object`);
  const step = value as Record<string, unknown>;
  validateStructuredLocator(step.locator, `${where}.locator`);
  assert(typeof step.action === 'string', `${where}: action must be a string`);
  assert(ACTION_METHOD_SET.has(step.action), `${where}: action "${String(step.action)}" is not allowlisted`);
  if (step.value !== undefined) assert(typeof step.value === 'string', `${where}: value must be a string`);
  if (step.optional !== undefined) assert(typeof step.optional === 'boolean', `${where}: optional must be a boolean`);
  if (step.waitForResponse !== undefined) {
    assert(typeof step.waitForResponse === 'string', `${where}: waitForResponse must be a string`);
  }
}

function validatePostcondition(value: unknown): asserts value is Postcondition {
  assert(value !== null && typeof value === 'object', 'postcondition must be an object');
  const post = value as Record<string, unknown>;
  assert(
    POSTCONDITION_ASSERTS.has(post.assert as PostconditionAssert),
    `postcondition.assert "${String(post.assert)}" is not supported`,
  );
  if (post.assert === 'url') {
    assert(typeof post.url === 'string', 'postcondition.url must be a string for a url assert');
  } else {
    validateStructuredLocator(post.locator, 'postcondition.locator');
  }
}

/**
 * Parse and validate an entry from its JSON text. Throws on any shape violation
 * or a method/action outside the allowlist — the interpreter can then trust the
 * returned entry without re-checking.
 */
export function parseEntry(text: string): AiEntry {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ArtifactError(`entry is not valid JSON: ${(error as Error).message}`);
  }
  assert(raw !== null && typeof raw === 'object', 'entry must be an object');
  const obj = raw as Record<string, unknown>;
  assert(obj.version === ARTIFACT_VERSION, `unsupported entry version ${String(obj.version)}`);
  assert(typeof obj.template === 'string', 'entry.template must be a string');

  if (obj.kind === 'locator') {
    validateStructuredLocator(obj.locator, 'entry.locator');
    return obj as unknown as LocatorEntry;
  }
  if (obj.kind === 'run') {
    assert(Array.isArray(obj.steps), 'entry.steps must be an array');
    obj.steps.forEach((step, i) => validateRunStep(step, `entry.steps[${i}]`));
    validatePostcondition(obj.postcondition);
    return obj as unknown as RunEntry;
  }
  throw new ArtifactError(`unsupported entry kind "${String(obj.kind)}"`);
}

// ── Reading & writing ────────────────────────────────────────────────────────

/** Read and validate an entry, or `null` when the file does not exist. */
export function readEntry(file: string): AiEntry | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseEntry(text);
}

/**
 * Serialize and write an entry atomically, skipping the write when the target
 * already holds identical canonical bytes (idempotence — a semantically equal
 * re-resolution never touches the file). A per-entry lock serializes concurrent
 * writers so the tmp+rename never races.
 */
export function writeEntry(file: string, entry: AiEntry): { written: boolean } {
  const canonical = serializeEntry(entry);
  return withEntryLock(file, () => {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === canonical) return { written: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, canonical);
    fs.renameSync(tmp, file);
    return { written: true };
  });
}

/**
 * Run `fn` while holding an exclusive lock on `file`. First writer wins the
 * lock; others spin briefly (bounded) and then re-read inside `fn`. The lock is
 * a sidecar file created with `wx`, always released in `finally`.
 */
export function withEntryLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > deadline) {
        // A stale lock from a crashed writer — reclaim it rather than deadlock.
        try {
          fs.unlinkSync(lock);
        } catch {
          /* another writer won the reclaim; retry */
        }
      }
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {
      /* already released */
    }
  }
}
