/**
 * Extract a worker index from a Playwright `TestResult`, falling back to
 * `parallelIndex` when `workerIndex` is absent. Returns `null` when neither is
 * set. Localizes the `as any` reach into Playwright's result object so the
 * cast lives in exactly one place.
 */
export function workerIndexOf(result: any): number | null {
  if (!result) return null;
  return result.workerIndex ?? result.parallelIndex ?? null;
}
