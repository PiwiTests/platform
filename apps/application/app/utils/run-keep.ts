/** One line saying who kept a run and why, for tooltips and the run details. */
export function describeKeep(run: {
  keepSource?: string | null;
  keepReason?: string | null;
  keptByName?: string | null;
}): string {
  const by =
    run.keepSource === 'reporter'
      ? 'by the reporter'
      : run.keepSource === 'marker'
        ? 'by a release marker'
        : run.keptByName
          ? `by ${run.keptByName}`
          : '';
  const head = by ? `Kept forever ${by}` : 'Kept forever';
  return run.keepReason ? `${head}: ${run.keepReason}` : head;
}
