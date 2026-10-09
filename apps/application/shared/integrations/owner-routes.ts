/**
 * Owner routes — how a team's failures reach that team's tracker project. A
 * cluster's owner (its assignee, else the `piwi:owner` annotation or
 * CODEOWNERS) picks the first route whose owner matches; the route's overrides
 * fill in on top of the binding's defaults. Pure, read by the create-issue
 * draft, the create path and the automatic-creation rules.
 */

/** One owner → tracker route. The first route whose owner matches wins. */
export interface OwnerRoute {
  /** The owner string a route matches — `@acme/checkout`, `alice@example.com`. */
  owner: string;
  /** Override the binding's tracker project key for this owner. */
  projectKey?: string | null;
  /** A tracker component id to set on the issue. */
  componentId?: string | null;
  /** The account id to assign the issue to. */
  assigneeAccountId?: string | null;
  /** Extra labels added on top of the binding's labels. */
  labels?: string[];
}

/** Lower-case, trimmed, leading `@` removed — the key owner strings match on. */
export function normalizeOwner(owner: string): string {
  return owner.trim().toLowerCase().replace(/^@/, '');
}

/**
 * The route for an owner: the first route whose owner matches, comparing
 * case-insensitively and ignoring a leading `@`. Returns null when no owner is
 * known or no route matches.
 */
export function pickOwnerRoute(routes: OwnerRoute[], owner: string | null | undefined): OwnerRoute | null {
  if (!owner) return null;
  const target = normalizeOwner(owner);
  return routes.find((route) => normalizeOwner(route.owner) === target) ?? null;
}
