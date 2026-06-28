/**
 * Shared types for locator healing — the in-runtime capture + storage of
 * alternative locators for every element interaction.
 *
 * Lives in `shared/` so both server and demo (in-browser sql.js) can
 * import the same definitions. The reporter package uses structural
 * compatibility (mirrored types, no shared import).
 */

/** A ranked alternative locator suggestion. */
export interface RankedLocator {
  locator: string;
  method: string;
  args: Record<string, unknown>;
  /** 0-100 stability score. data-testid=100, semantic CSS=35-40, hash-suffixed=10. */
  score: number;
}

/**
 * The single recommended fix, chosen from the stability-ranked alternatives so
 * it keeps the developer's original locator style where that style is stable
 * enough — a minimal, idiomatic edit. The full ranked menu stays available; this
 * just picks the one fix to surface as the "Top recommendation".
 */
export interface LocatorFixRecommendation {
  /** The recommended fix. Null only when there are no alternatives at all. */
  recommended: RankedLocator | null;
  /** The most stable alternative overall — surfaced so a sturdier (but different) choice stays visible. */
  durable: RankedLocator | null;
  /** True when `recommended` keeps the failing locator's method family (same style). */
  preservesConvention: boolean;
  /** True when `durable` is a different, sturdier option than `recommended`. */
  hasDurableAlternative: boolean;
  /** True when nothing cleared the stability floor — advise adding a `data-testid` to the app. */
  suggestAddTestId: boolean;
}

/** Raw element attributes captured after a successful action. */
export interface ElementAttributes {
  tagName: string;
  attributes: Record<string, string | null>;
  /** Visible text, truncated to 80 chars. */
  textContent: string | null;
  /** Browser-computed accessible name from ariaSnapshot(). */
  accessibleName: string | null;
  /** Center point of the element's bounding box — spatial discriminator. */
  center: { x: number; y: number } | null;
}

/** One captured element interaction (per locator call site). */
export interface LocatorSnapshot {
  /** The Playwright step location — unique, stable identity of this call site. */
  location: string | null;
  /** Index of this step within the test case's pw:api steps. */
  stepIndex: number;
  /** The locator the test code actually used. */
  used: {
    method: string;
    /** All args passed to the locator method. */
    args: unknown[];
    /** Original step title, for round-tripping. */
    raw: string;
  };
  /** Element attributes — null for gap entries (failed actions). */
  element: {
    tagName: string;
    attributes: Record<string, string | null>;
    textContent: string | null;
    accessibleName: string | null;
    center: { x: number; y: number } | null;
  } | null;
  /** Computed alternative locators, ranked by stability score (max 10). */
  alternatives: RankedLocator[];
}
