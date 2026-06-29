import type { TestAnnotation } from '../../types.js';

/** Minimal structural shape for the annotation carriers (avoids importing Playwright types). */
interface AnnotationCarrier {
  annotations?: ReadonlyArray<{ type: string; description?: string }>;
}

/**
 * Merge a test's declared annotations (`test.annotations`) with its result-level
 * annotations (`result.annotations`), deduped by `type + description`. Runtime
 * `test.skip('reason')` calls can surface on either side depending on the
 * Playwright version, so both are considered.
 */
export function mergeAnnotations(test: AnnotationCarrier, result: AnnotationCarrier): TestAnnotation[] {
  const out: TestAnnotation[] = [];
  const seen = new Set<string>();
  for (const list of [test.annotations, result.annotations]) {
    for (const a of list ?? []) {
      const key = `${a.type}\x00${a.description ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a.description === undefined ? { type: a.type } : { type: a.type, description: a.description });
    }
  }
  return out;
}

/**
 * Distinguish an intentional skip from a test that could not run.
 *
 * Playwright reports both as `result.status === 'skipped'`, but an intentional
 * `test.skip()` / `test.fixme()` (static, conditional, or runtime) always
 * carries a `skip`/`fixme` annotation, while a test skipped as a side effect of
 * an earlier failure in a `describe.serial` group carries none. The latter is
 * reclassified to `didnotrun` so the dashboard can tell "deliberately skipped"
 * from "never actually executed". Non-skipped statuses pass through unchanged.
 */
export function classifyStatus(rawStatus: string, annotations: TestAnnotation[]): string {
  if (rawStatus !== 'skipped') return rawStatus;
  const intentional = annotations.some((a) => a.type === 'skip' || a.type === 'fixme');
  return intentional ? 'skipped' : 'didnotrun';
}
