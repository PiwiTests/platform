export type {
  AncestorAnchor,
  ElementAttributes,
  RankedLocator,
  RolePosition,
  SelectorCounts,
} from '@piwitests/core/locator-healing-types';

/** Arguments for `probeElementAttrs` — the role maps mirror the single source of truth in `@piwitests/core`. */
export interface ProbeArg {
  /** Attribute whitelist to read off the element (the shared `CAPTURED_ATTRIBUTES`). */
  keep: string[];
  /** Required when `includeStructural` is true — role resolution needs the tag/input-type role maps. */
  tagRoles?: Record<string, string>;
  inputRoles?: Record<string, string>;
  /** CSS selector matching every element role resolution can reach (also structural-only). */
  roleSources?: string;
  /** Compute `rolePosition` and ancestor-anchor candidates. The live picker always wants these; the snapshot picker never does (no anchors step there). */
  includeStructural: boolean;
  /** Include the associated `<label>` text as `labelText`. The snapshot picker derives its accessible name from this client-side; the live picker doesn't need it (Node-side derives it separately). */
  includeLabelText: boolean;
}

/** Element shape the in-page probe returns — structural view of what the picker overlays need. */
export interface ProbedAttrs {
  tagName: string;
  attributes: Record<string, string | null>;
  textContent: string;
  center: { x: number; y: number };
  hasLabel: boolean;
  labelText?: string | null;
  selectorCounts: {
    testId?: number;
    id?: number;
    name?: number;
    classes?: Record<string, number>;
    /** How many elements share this element's role *and* accessible name — i.e. what `getByRole(role, { name })` would really match. */
    roleName?: number;
    /** Of the `roleName` matches, how many are laid out (a box, or an `offsetParent`) — what `getByRole(role, { name }).visible()` would match. */
    visibleRoleName?: number;
    /** How many elements `getByText` would match on this element's text, counted no further than 2 — every consumer only asks whether that is exactly one. Undefined when the element has no text, or the subtree was too large to scan. */
    text?: number;
    /** How many elements share this element's `placeholder` — what `getByPlaceholder` would really match. */
    placeholder?: number;
    /** How many elements share this element's `alt` — what `getByAltText` would really match. */
    alt?: number;
    /** How many elements share this element's `title` — what `getByTitle` would really match. */
    title?: number;
  };
  rolePosition?: {
    role: string;
    count: number;
    index: number;
    levelCount?: number;
  } | null;
  ancestors?: Array<{
    tag: string;
    depth: number;
    testId: string | null;
    id: string | null;
    role: string | null;
    ariaLabel: string | null;
    scopedRoleCount?: number;
    scopedTextCount?: number;
    testIdCount?: number;
    idCount?: number;
    roleCount?: number;
    dataAttr?: { name: string; value: string };
    dataAttrCount?: number;
    filterText?: string;
    filterRoleCount?: number;
  }>;
}
