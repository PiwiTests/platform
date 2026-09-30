/** The columns of the `(run, case, retries, browser)` unique index that a batch row carries. */
interface RunCaseKey {
  testCaseId: number;
  retries?: number | null;
  browserName?: string | null;
}

function keyOf(row: RunCaseKey): string {
  return `${row.testCaseId}\x00${row.retries ?? 0}\x00${row.browserName ?? ''}`;
}

/**
 * Pair each row an `INSERT … ON CONFLICT DO NOTHING RETURNING` into
 * `test_runs_cases` gave back with the index of the batch row it came from. A
 * skipped row returns nothing, so the returned rows are matched on the unique
 * `(run, case, retries, browser)` key rather than by position: when the batch
 * repeats a key the first row is the one stored, and rows without a browser
 * never conflict, so rows sharing a key are matched in batch order.
 */
export function matchInsertedRunCases<T extends RunCaseKey>(
  rows: RunCaseKey[],
  inserted: T[],
): Array<T & { rowIndex: number }> {
  const indicesByKey = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = keyOf(row);
    const indices = indicesByKey.get(key);
    if (indices) indices.push(index);
    else indicesByKey.set(key, [index]);
  });

  return inserted.flatMap((row) => {
    const rowIndex = indicesByKey.get(keyOf(row))?.shift();
    return rowIndex === undefined ? [] : [{ ...row, rowIndex }];
  });
}
