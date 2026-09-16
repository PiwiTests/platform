/**
 * The per-project binding — how a project's failures reach a tracker: which
 * connection, which Jira project and issue type, the default labels and
 * assignee, the include toggles, the two-way sync policies, the owner routes
 * that file a team's failures into that team's project, and the auto-create
 * fields (stored but inert this milestone).
 *
 * Pure + dependency-free, mirroring `shared/auto-heal.ts`: the code that reads
 * the binding and talks to Jira lives in `server/utils/integrations/`. The
 * settings endpoint stores a resolved object; `resolveProjectIntegration`
 * clamps and normalizes an arbitrary (possibly untrusted) payload onto the
 * defaults so every reader sees the same shape.
 */
import { toIssueLocale, type IssueLocale } from './messages';
import type { IssueIncludeOptions } from './types';

/** One owner → tracker route. The first route whose owner matches wins. */
export interface OwnerRoute {
  /** The owner string a route matches — `@acme/checkout`, `alice@example.com`. */
  owner: string;
  /** Override the binding's Jira project key for this owner. */
  projectKey?: string | null;
  /** A Jira component id to set on the issue. */
  componentId?: string | null;
  /** The account id to assign the issue to. */
  assigneeAccountId?: string | null;
  /** Extra labels added on top of the binding's labels. */
  labels?: string[];
}

/** The two-way sync policies — each a boolean off by default, plus the transition ids. */
export interface ProjectIntegrationPolicies {
  /** Comment on the known issue when the cluster's fix is verified. */
  commentOnFix: boolean;
  /** Transition the issue on fix (to `fixTransitionId`). */
  transitionOnFix: boolean;
  /** The transition id (or status name) used when `transitionOnFix` is on. */
  fixTransitionId: string | null;
  /** Comment on the known issue when the cluster regresses. */
  commentOnRegression: boolean;
  /** The transition id (or status name) used to reopen the issue on regression. */
  reopenTransitionId: string | null;
  /** At most one comment per day when new occurrences land on an open ticket. */
  commentOnNewOccurrences: boolean;
  /** Resolve the cluster automatically when its ticket moves to Done. */
  resolveOnClose: boolean;
  /** Reopen the cluster when its ticket is reopened while the cluster is resolved. */
  reopenOnTicketReopen: boolean;
  /** Comment on both issues when a cluster is merged into another. */
  commentOnMerge: boolean;
  /** Days a cluster may sit open on the default branch with no ticket before the needs-ticket queue lists it. */
  needsTicketAfterDays: number;
}

/** The auto-create guards — stored so the form persists them, inert until step 4. */
export interface AutoCreatePolicy {
  /** Master switch. Always false this milestone — the trigger is unimplemented. */
  enabled: boolean;
  /** Minimum distinct occurrences before a cluster qualifies. */
  minOccurrences: number;
  /** Minimum distinct runs the occurrences span. */
  minRuns: number;
  /** Cap on issues auto-created per project per day. */
  dailyCap: number;
  /** File clusters whose owner matches no route into the binding's default project. */
  routeUnmatchedToDefault: boolean;
}

/** The resolved binding the settings endpoint stores and every reader sees. */
export interface ResolvedProjectIntegration {
  /** The tracker connection this binding targets, or null when unbound. */
  connectionId: number | null;
  /** The Jira project key issues are filed into. */
  projectKey: string | null;
  /** The Jira issue type id. */
  issueType: string | null;
  /** Labels added to every issue filed under this binding. */
  labels: string[];
  /** The account id issues are assigned to by default. */
  defaultAssignee: string | null;
  /** The ticket language, or null to inherit the connection's default. */
  locale: IssueLocale | null;
  /** What a ticket body carries. */
  include: IssueIncludeOptions;
  /** The two-way sync policies. */
  policies: ProjectIntegrationPolicies;
  /** Owner → tracker routes, in priority order. */
  ownerRoutes: OwnerRoute[];
  /** The auto-create guards (inert). */
  autoCreate: AutoCreatePolicy;
}

export const DEFAULT_INCLUDE: IssueIncludeOptions = {
  includeDiagnosis: true,
  includePatch: true,
  includeScreenshot: false,
  includeShareLink: false,
};

export const DEFAULT_POLICIES: ProjectIntegrationPolicies = {
  commentOnFix: false,
  transitionOnFix: false,
  fixTransitionId: null,
  commentOnRegression: false,
  reopenTransitionId: null,
  commentOnNewOccurrences: false,
  resolveOnClose: false,
  reopenOnTicketReopen: false,
  commentOnMerge: false,
  needsTicketAfterDays: 2,
};

export const DEFAULT_AUTO_CREATE: AutoCreatePolicy = {
  enabled: false,
  minOccurrences: 2,
  minRuns: 2,
  dailyCap: 5,
  routeUnmatchedToDefault: false,
};

export const DEFAULT_PROJECT_INTEGRATION: ResolvedProjectIntegration = {
  connectionId: null,
  projectKey: null,
  issueType: null,
  labels: [],
  defaultAssignee: null,
  locale: null,
  include: DEFAULT_INCLUDE,
  policies: DEFAULT_POLICIES,
  ownerRoutes: [],
  autoCreate: DEFAULT_AUTO_CREATE,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Trim, drop empties, cap length and dedupe a label list. */
function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.slice(0, 100));
  return [...new Set(cleaned)].slice(0, 50);
}

function trimOrNull(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizeOwnerRoute(raw: unknown): OwnerRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const owner = trimOrNull(r.owner);
  if (!owner) return null;
  return {
    owner,
    projectKey: trimOrNull(r.projectKey),
    componentId: trimOrNull(r.componentId),
    assigneeAccountId: trimOrNull(r.assigneeAccountId),
    labels: normalizeLabels(r.labels),
  };
}

function resolveInclude(raw: unknown): IssueIncludeOptions {
  const r = (raw ?? {}) as Partial<IssueIncludeOptions>;
  return {
    includeDiagnosis: r.includeDiagnosis !== false,
    includePatch: r.includePatch !== false,
    includeScreenshot: r.includeScreenshot === true,
    includeShareLink: r.includeShareLink === true,
  };
}

function resolvePolicies(raw: unknown): ProjectIntegrationPolicies {
  const r = (raw ?? {}) as Partial<ProjectIntegrationPolicies>;
  return {
    commentOnFix: r.commentOnFix === true,
    transitionOnFix: r.transitionOnFix === true,
    fixTransitionId: trimOrNull(r.fixTransitionId, 100),
    commentOnRegression: r.commentOnRegression === true,
    reopenTransitionId: trimOrNull(r.reopenTransitionId, 100),
    commentOnNewOccurrences: r.commentOnNewOccurrences === true,
    resolveOnClose: r.resolveOnClose === true,
    reopenOnTicketReopen: r.reopenOnTicketReopen === true,
    commentOnMerge: r.commentOnMerge === true,
    needsTicketAfterDays: clampInt(r.needsTicketAfterDays, 0, 365, DEFAULT_POLICIES.needsTicketAfterDays),
  };
}

function resolveAutoCreate(raw: unknown): AutoCreatePolicy {
  const r = (raw ?? {}) as Partial<AutoCreatePolicy>;
  return {
    // The trigger is unimplemented this milestone — the field is stored but never
    // read to create anything, and the form renders it disabled.
    enabled: r.enabled === true,
    minOccurrences: clampInt(r.minOccurrences, 1, 1000, DEFAULT_AUTO_CREATE.minOccurrences),
    minRuns: clampInt(r.minRuns, 1, 1000, DEFAULT_AUTO_CREATE.minRuns),
    dailyCap: clampInt(r.dailyCap, 0, 1000, DEFAULT_AUTO_CREATE.dailyCap),
    routeUnmatchedToDefault: r.routeUnmatchedToDefault === true,
  };
}

/** Merge a partial (possibly untrusted) payload onto the defaults. */
export function resolveProjectIntegration(
  input?: Partial<ResolvedProjectIntegration> | null,
): ResolvedProjectIntegration {
  const connectionId =
    typeof input?.connectionId === 'number' && Number.isInteger(input.connectionId) && input.connectionId > 0
      ? input.connectionId
      : null;
  const ownerRoutes = Array.isArray(input?.ownerRoutes)
    ? input!.ownerRoutes.map(normalizeOwnerRoute).filter((r): r is OwnerRoute => r != null)
    : [];
  return {
    connectionId,
    projectKey: trimOrNull(input?.projectKey, 100),
    issueType: trimOrNull(input?.issueType, 100),
    labels: normalizeLabels(input?.labels),
    defaultAssignee: trimOrNull(input?.defaultAssignee),
    locale: toIssueLocale(input?.locale),
    include: resolveInclude(input?.include),
    policies: resolvePolicies(input?.policies),
    ownerRoutes,
    autoCreate: resolveAutoCreate(input?.autoCreate),
  };
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

/** Lower-case, trimmed, leading `@` removed — the key owner strings match on. */
export function normalizeOwner(owner: string): string {
  return owner.trim().toLowerCase().replace(/^@/, '');
}
