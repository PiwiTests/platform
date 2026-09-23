/**
 * Gap classes ranked by how loudly they should be shown. The graph views color
 * a node by its worst open gap and rank neighbors by it, and the feature map
 * colors a feature by the worst gap under it — all with this one order, so a
 * red feature on the map is red for the same reason a red node is red. Pure,
 * shared by the server, the demo and the app.
 */

/** Severity per class, higher first; an unknown class ranks lowest among gaps. */
const SEVERITY: Record<string, number> = {
  unhandled: 5,
  'false-comfort': 4,
  degraded: 3,
  'blind-spot': 2,
  fragile: 1,
};

/** A class's severity; null (no open gap) is zero. */
export function gapClassSeverity(cls: string | null | undefined): number {
  if (!cls) return 0;
  return SEVERITY[cls] ?? 0.5;
}

/** The most severe class among the given, or null when none. */
export function worstGapClass(classes: Iterable<string | null | undefined>): string | null {
  let worst: string | null = null;
  let worstScore = 0;
  for (const cls of classes) {
    const s = gapClassSeverity(cls);
    if (cls && s > worstScore) {
      worst = cls;
      worstScore = s;
    }
  }
  return worst;
}
