/**
 * The Test Map of the demo's web-dashboard project: the admin console of a SaaS
 * product, ten tests against a surface many times their size.
 *
 * One model drives every row the seed writes for it: each test's requests and
 * the page it ends on, the inventory of the pages its passing runs visit, the
 * handler and dependencies behind each route, the declared OpenAPI surface and
 * the probe outcomes. The gaps listed at the end are what the live detectors
 * find in that graph; `demo-test-map.test.ts` recomputes them from the seed and
 * fails when the two disagree. Pure plain-JS module, read by the seed generator
 * and by that test.
 */

import DETECTED_GAPS from './demo-test-map-gaps.json' with { type: 'json' };

export const WEB_DASHBOARD_PROJECT_ID = 5;
const WEB_DASHBOARD_ORIGIN = 'https://admin.example.com';

/** The handler file and the dependencies its child spans name, per route. */
const ROUTES = {
  'POST /api/auth/sso/start': { handler: 'server/api/auth/sso/start.post.ts', calls: ['okta', 'redis'] },
  'GET /api/auth/sso/callback': {
    handler: 'server/api/auth/sso/callback.get.ts',
    calls: ['okta', 'postgres', 'redis'],
  },
  'GET /api/session': { handler: 'server/api/session.get.ts', calls: ['redis'], responses: [200, 401] },
  'GET /api/dashboard/summary': { handler: 'server/api/dashboard/summary.get.ts', calls: ['clickhouse'] },
  'GET /api/orgs/current': { handler: 'server/api/orgs/current.get.ts', calls: ['postgres'] },
  'PATCH /api/orgs/current': {
    handler: 'server/api/orgs/current.patch.ts',
    calls: ['postgres'],
    responses: [200, 403, 422],
  },
  'GET /api/users': { handler: 'server/api/users/index.get.ts', calls: ['postgres'] },
  'GET /api/roles': { handler: 'server/api/roles/index.get.ts', calls: ['postgres'] },
  'POST /api/invitations': {
    handler: 'server/api/invitations/index.post.ts',
    calls: ['postgres', 'sendgrid'],
    responses: [201, 409, 422],
  },
  'GET /api/reports/revenue': { handler: 'server/api/reports/revenue.get.ts', calls: ['clickhouse'] },
  'POST /api/reports/exports': {
    handler: 'server/api/reports/exports/index.post.ts',
    calls: ['clickhouse', 's3'],
    responses: [202, 429],
  },
  'GET /api/reports/exports/:id': { handler: 'server/api/reports/exports/[id].get.ts', calls: ['s3'] },
  'GET /api/tokens': { handler: 'server/api/tokens/index.get.ts', calls: ['postgres'] },
  'POST /api/tokens/:id/rotate': {
    handler: 'server/api/tokens/[id]/rotate.post.ts',
    calls: ['postgres', 'vault'],
    responses: [200, 403, 404],
  },
  'GET /api/me/preferences': { handler: 'server/api/me/preferences.get.ts', calls: ['postgres'] },
  'PUT /api/me/preferences': { handler: 'server/api/me/preferences.put.ts', calls: ['postgres'] },
};

/** Routes the project's OpenAPI document declares that no test requests, with their documented codes. */
const DECLARED_ROUTES = {
  'PATCH /api/users/:id': [200, 403, 404, 422],
  'DELETE /api/users/:id': [204, 403, 404],
  'DELETE /api/invitations/:id': [204, 404],
  'GET /api/audit-log': [200, 403],
  'GET /api/billing/invoices': [200, 402],
  'POST /api/billing/subscription': [200, 402, 409],
  'POST /api/integrations/slack': [201, 400, 409],
  'DELETE /api/tokens/:id': [204, 404],
  'POST /api/auth/password/reset': [202, 429],
  'DELETE /api/orgs/current': [202, 403, 409],
};

const SETTINGS_NAV = [
  ['Organization', '/settings/organization'],
  ['Security', '/settings/security'],
  ['API tokens', '/settings/api-tokens'],
  ['Appearance', '/settings/appearance'],
  ['Billing', '/billing'],
];

/**
 * The page inventory of every page a passing test visits: its controls (role and
 * accessible name), its links and the routes it loads while it settles.
 */
const PAGES = {
  '/login': {
    controls: [
      ['textbox', 'Work email'],
      ['button', 'Continue with SSO'],
      ['button', 'Sign in with a password'],
      ['checkbox', 'Keep me signed in'],
    ],
    links: [
      ['Forgot your password?', '/forgot-password'],
      ['Request access', '/request-access'],
    ],
    loads: [],
  },
  '/dashboard': {
    controls: [
      ['combobox', 'Date range'],
      ['button', 'Refresh'],
      ['button', 'Invite teammates'],
      ['searchbox', 'Search'],
    ],
    links: [
      ['Users', '/users'],
      ['Reports', '/reports'],
      ['Billing', '/billing'],
      ['Audit log', '/audit-log'],
      ['Integrations', '/integrations'],
      ['Settings', '/settings/organization'],
    ],
    loads: ['GET /api/session', 'GET /api/dashboard/summary', 'GET /api/orgs/current'],
  },
  '/users': {
    controls: [
      ['searchbox', 'Search users'],
      ['combobox', 'Role'],
      ['button', 'Invite user'],
      ['button', 'Next page'],
      ['button', 'Export users'],
      ['button', 'Deactivate'],
    ],
    links: [
      ['Roles and permissions', '/roles'],
      ['Invite user', '/users/invite'],
    ],
    loads: ['GET /api/session', 'GET /api/users', 'GET /api/roles'],
  },
  '/users/invite': {
    controls: [
      ['textbox', 'Email address'],
      ['combobox', 'Role'],
      ['button', 'Send invitation'],
      ['button', 'Cancel'],
    ],
    links: [],
    loads: ['GET /api/roles'],
  },
  '/reports': {
    controls: [
      ['combobox', 'Range'],
      ['tab', 'Revenue'],
      ['tab', 'Churn'],
      ['tab', 'Cohorts'],
      ['button', 'Export CSV'],
      ['button', 'Schedule report'],
    ],
    links: [['Scheduled reports', '/reports/schedules']],
    loads: ['GET /api/session', 'GET /api/reports/revenue'],
  },
  '/settings/organization': {
    controls: [
      ['textbox', 'Organization name'],
      ['button', 'Save changes'],
      ['button', 'Transfer ownership'],
      ['button', 'Delete organization'],
    ],
    links: [...SETTINGS_NAV, ['Single sign-on', '/settings/sso']],
    loads: ['GET /api/session', 'GET /api/orgs/current'],
  },
  '/settings/api-tokens': {
    controls: [
      ['button', 'Create token'],
      ['combobox', 'Scope'],
      ['button', 'Rotate'],
      ['button', 'Revoke'],
    ],
    links: [...SETTINGS_NAV, ['Single sign-on', '/settings/sso']],
    loads: ['GET /api/session', 'GET /api/tokens'],
  },
  '/settings/appearance': {
    controls: [
      ['switch', 'Dark mode'],
      ['radio', 'Compact'],
      ['radio', 'Comfortable'],
    ],
    links: SETTINGS_NAV,
    loads: ['GET /api/session', 'GET /api/me/preferences'],
  },
};

/**
 * Each test's journey: the pages it visits in order, ending on the last, and the
 * requests it makes, as `[method, path, status]`. The seed writes the requests on
 * every execution and the last page as where the execution ended.
 */
const WEB_DASHBOARD_JOURNEYS = {
  'signs in with SSO redirect': {
    pages: ['/login', '/dashboard'],
    requests: [
      ['POST', '/api/auth/sso/start', 303],
      ['GET', '/api/auth/sso/callback', 302],
      ['GET', '/api/session', 200],
      ['GET', '/api/dashboard/summary', 200],
      ['GET', '/api/orgs/current', 200],
    ],
  },
  'shows an error for a revoked account': {
    pages: ['/login'],
    requests: [
      ['POST', '/api/auth/sso/start', 303],
      ['GET', '/api/auth/sso/callback', 403],
    ],
  },
  'Users table paginates 25 rows per page': {
    pages: ['/users'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/users', 200],
      ['GET', '/api/roles', 200],
    ],
  },
  'invites a user by email': {
    pages: ['/users', '/users/invite', '/users'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/users', 200],
      ['GET', '/api/roles', 200],
      ['POST', '/api/invitations', 201],
    ],
  },
  'filters users by role': {
    pages: ['/users'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/users', 200],
      ['GET', '/api/roles', 200],
    ],
  },
  'renders the revenue chart': {
    pages: ['/dashboard', '/reports'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/dashboard/summary', 200],
      ['GET', '/api/reports/revenue', 200],
    ],
  },
  'exports the monthly report as CSV': {
    pages: ['/reports'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/reports/revenue', 200],
      ['POST', '/api/reports/exports', 202],
      ['GET', '/api/reports/exports/918', 200],
    ],
  },
  'updates the organization name': {
    pages: ['/settings/organization'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/orgs/current', 200],
      ['PATCH', '/api/orgs/current', 200],
    ],
  },
  'rotates the API token': {
    pages: ['/settings/organization', '/settings/api-tokens'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/tokens', 200],
      ['POST', '/api/tokens/42/rotate', 200],
    ],
  },
  'toggles dark mode': {
    pages: ['/settings/appearance'],
    requests: [
      ['GET', '/api/session', 200],
      ['GET', '/api/me/preferences', 200],
      ['PUT', '/api/me/preferences', 200],
    ],
  },
};

/**
 * Probe outcomes. Client probes rewrite a route's response in the browser; server
 * probes fail one dependency call inside the server. A server probe the
 * application only degraded under also leaves a resilience finding.
 */
const CLIENT_PROBES = [
  { test: 'signs in with SSO redirect', route: 'GET /api/session', fault: 'status-500', outcome: 'noticed' },
  { test: 'filters users by role', route: 'GET /api/users', fault: 'empty-body', outcome: 'noticed' },
  { test: 'invites a user by email', route: 'POST /api/invitations', fault: 'status-500', outcome: 'not-noticed' },
  { test: 'renders the revenue chart', route: 'GET /api/reports/revenue', fault: 'empty-body', outcome: 'not-noticed' },
  {
    test: 'exports the monthly report as CSV',
    route: 'POST /api/reports/exports',
    fault: 'status-500',
    outcome: 'noticed',
  },
  {
    test: 'updates the organization name',
    route: 'PATCH /api/orgs/current',
    fault: 'stale-value',
    outcome: 'not-noticed',
  },
  { test: 'rotates the API token', route: 'POST /api/tokens/:id/rotate', fault: 'drop-field', outcome: 'noticed' },
  { test: 'toggles dark mode', route: 'PUT /api/me/preferences', fault: 'slow', outcome: 'inconclusive' },
];
const SERVER_PROBES = [
  {
    test: 'exports the monthly report as CSV',
    route: 'POST /api/reports/exports',
    dependency: 's3',
    outcome: 'noticed',
    handled: 'graceful',
  },
  {
    test: 'invites a user by email',
    route: 'POST /api/invitations',
    dependency: 'sendgrid',
    outcome: 'not-noticed',
    handled: 'degraded',
  },
  {
    test: 'updates the organization name',
    route: 'PATCH /api/orgs/current',
    dependency: 'postgres',
    outcome: 'noticed',
    handled: 'graceful',
  },
];

const DAY_MS = 86_400_000;

/**
 * The team's verdicts on the detected gaps, by detector and key: the gap accepted
 * more than a week ago whose test was never written, a snoozed dependency, the
 * API-only routes dismissed as wrong (the controls that send them are clicked,
 * not loaded) and a page dismissed as not worth testing.
 */
const TRIAGE = {
  'success-only POST /api/invitations': { status: 'accepted', acceptedDaysAgo: 9 },
  'unprobed-dependency dependency:vault': { status: 'snoozed', snoozedForDays: 5 },
  'api-only-route route:POST /api/auth/sso/start': { status: 'dismissed', reason: 'wrong' },
  'api-only-route route:GET /api/auth/sso/callback': { status: 'dismissed', reason: 'wrong' },
  'api-only-route route:PATCH /api/orgs/current': { status: 'dismissed', reason: 'wrong' },
  'api-only-route route:POST /api/tokens/:id/rotate': { status: 'dismissed', reason: 'wrong' },
  'api-only-route route:PUT /api/me/preferences': { status: 'dismissed', reason: 'wrong' },
  'reachable-unvisited page:/request-access': { status: 'dismissed', reason: 'not-worth-testing' },
};

const FLOOR_FACTORS = { churn: 0.1, age: 0.1, escapeHistory: 0.1, priority: 0.1 };

/**
 * Gaps the ledger has already closed, which the detectors no longer raise: the
 * dashboard page a second test was named as covering, and the callback route a
 * revoked-account test made answer 403.
 */
const CLOSED = [
  {
    detector: 'single-covering-test',
    class: 'fragile',
    key: 'page:/dashboard',
    title: 'Only one test reaches page /dashboard',
    evidence: [
      'Only signs in with SSO redirect reaches this — observed reach. A second scenario would make it resilient.',
    ],
    factors: { ...FLOOR_FACTORS, priority: 0.4 },
    score: 0.0707,
    test: 'signs in with SSO redirect',
    coveredDaysAgo: 6,
  },
  {
    detector: 'success-only',
    class: 'blind-spot',
    key: 'GET /api/auth/sso/callback',
    title: 'GET /api/auth/sso/callback: no error path under test',
    evidence: ['Observed 12 times over the last 30 runs, always 302 — observed reach, no error path exercised.'],
    factors: { ...FLOOR_FACTORS, priority: 0.4 },
    score: 0.0849,
    test: null,
    closedDaysAgo: 20,
  },
];

/** The resilience finding the sendgrid server probe left: the invite form degraded, and no test noticed. */
const FINDINGS = [
  {
    detector: 'not-handled',
    class: 'degraded',
    key: 'dependency:sendgrid @ POST /api/invitations',
    title: 'sendgrid (via POST /api/invitations): degraded failure',
    evidence: [
      'A server probe made sendgrid (via POST /api/invitations) fail; the application degraded under it (invites a user by email) — an error-state scenario is missing.',
    ],
    factors: FLOOR_FACTORS,
    score: 0.05,
    test: 'invites a user by email',
  },
];

/** A path with numeric ids collapsed, as the route normalizer collapses them. */
function routePattern(path) {
  return path.replace(/\/\d+(?=\/|$)/g, '/:id');
}

function routeKeyOf([method, path]) {
  return `${method} ${routePattern(path)}`;
}

/** A control node's key, `role:name`. The model's names hold no digits, dates or ids, so templating leaves them as they are. */
function controlKey(role, name) {
  return `${role}:${name}`;
}

/**
 * Every Test Map row the seed writes for the project, given the ids it assigned:
 * `caseIds` maps a test title to its test case id, `runIds` lists the project's
 * runs oldest first, and `features` maps a test title to its `piwi:feature` tag.
 * The graph was built over the project's history, so nodes are first seen in its
 * first run; the single-sign-on settings link is new in the latest one.
 */
export function buildWebDashboardTestMap({ caseIds, runIds, features, at }) {
  const projectId = WEB_DASHBOARD_PROJECT_ID;
  const firstRun = runIds[0];
  const latestRun = runIds[runIds.length - 1];
  const newInLatest = new Set(['page\x00/settings/sso', 'link\x00link:Single sign-on']);

  const nodes = new Map();
  const edges = new Map();
  const addNode = (kind, key, origin = 'observed', attrs = null) => {
    const id = `${kind}\x00${key}`;
    if (nodes.has(id)) return;
    nodes.set(id, {
      project_id: projectId,
      kind,
      key,
      attrs,
      origin,
      first_seen_run_id: newInLatest.has(id) ? latestRun : firstRun,
      last_seen_run_id: latestRun,
      last_seen_at: at,
      created_at: at,
    });
  };
  const addEdge = (fromKind, fromKey, kind, toKind, toKey, extra = {}) => {
    const id = `${fromKind}\x00${fromKey}\x00${kind}\x00${toKind}\x00${toKey}`;
    if (edges.has(id)) return;
    edges.set(id, {
      project_id: projectId,
      from_kind: fromKind,
      from_key: String(fromKey),
      to_kind: toKind,
      to_key: toKey,
      kind,
      confidence: null,
      origin: 'observed',
      evidence: null,
      first_seen_run_id: newInLatest.has(`${toKind}\x00${toKey}`) ? latestRun : firstRun,
      last_seen_run_id: latestRun,
      last_seen_at: at,
      created_at: at,
      ...extra,
    });
  };
  const caseId = (title) => {
    const id = caseIds.get(title);
    if (id == null) throw new Error(`web-dashboard Test Map: no test case "${title}"`);
    return id;
  };

  // Routes, their handlers and the dependencies those call.
  for (const [route, spec] of Object.entries(ROUTES)) {
    addNode('route', route, 'observed', spec.responses ? { responses: spec.responses } : null);
    addNode('handler', spec.handler);
    addEdge('route', route, 'handled-by', 'handler', spec.handler);
    for (const dep of spec.calls) {
      addNode('dependency', dep);
      addEdge('handler', spec.handler, 'calls', 'dependency', dep);
    }
  }
  for (const [route, responses] of Object.entries(DECLARED_ROUTES)) {
    addNode('route', route, 'openapi', { declared: true, responses });
  }

  // The page inventory: controls, links and the routes each page loads.
  for (const [page, spec] of Object.entries(PAGES)) {
    addNode('page', page);
    for (const [role, name] of spec.controls) {
      const key = controlKey(role, name);
      addNode('control', key, 'observed', { role });
      addEdge('page', page, 'contains', 'control', key);
    }
    for (const [name, target] of spec.links) {
      const key = `link:${name}`;
      addNode('link', key, 'observed', { href: target });
      addEdge('page', page, 'contains', 'link', key);
      if (target !== page) {
        addNode('page', target);
        addEdge('page', page, 'links', 'page', target);
      }
    }
    for (const route of spec.loads) addEdge('page', page, 'loads', 'route', route);
  }

  // Reach: every route a test requested, and the page it ended on.
  const reachedBy = new Map(); // "kind\0key" → test titles
  const reach = (title, kind, key, evidence = null, origin = 'observed') => {
    addEdge('test', caseId(title), 'reaches', kind, key, { confidence: 1, origin, evidence });
    const id = `${kind}\x00${key}`;
    reachedBy.set(id, new Set([...(reachedBy.get(id) ?? []), title]));
  };
  for (const [title, journey] of Object.entries(WEB_DASHBOARD_JOURNEYS)) {
    for (const request of journey.requests) {
      reach(title, 'route', routeKeyOf(request), { method: request[0], status: request[2] });
    }
    reach(title, 'page', journey.pages[journey.pages.length - 1]);
  }
  // A covered-by verdict: the revenue chart test was named as covering the dashboard page.
  reach('renders the revenue chart', 'page', '/dashboard', null, 'manual');

  // Features from the `piwi:feature` tag: each groups the routes and pages its tests reach.
  for (const [id, titles] of reachedBy) {
    const [kind, key] = id.split('\x00');
    if (kind !== 'route' && kind !== 'page') continue;
    for (const title of titles) {
      const feature = features.get(title);
      if (!feature) continue;
      addNode('feature', feature, 'observed', { source: 'tag' });
      addEdge('feature', feature, 'groups', kind, key);
    }
  }

  // Probe outcomes, each refreshing one `checks` edge.
  const probes = [];
  for (const p of CLIENT_PROBES) {
    probes.push({
      project_id: projectId,
      test_case_id: caseId(p.test),
      node_id: null,
      route_key: p.route,
      level: 'client',
      fault: p.fault,
      applied: 1,
      outcome: p.outcome,
      handled: 'n/a',
      run_id: latestRun,
      evidence: { mutation: p.fault },
      probed_at: at,
    });
    if (p.outcome === 'inconclusive') continue;
    addEdge('test', caseId(p.test), 'checks', 'route', p.route, {
      confidence: p.outcome === 'noticed' ? 1 : 0,
      evidence: { fault: p.fault, outcome: p.outcome, level: 'client' },
    });
  }
  for (const p of SERVER_PROBES) {
    probes.push({
      project_id: projectId,
      test_case_id: caseId(p.test),
      node_id: null,
      route_key: p.route,
      level: 'server',
      fault: 'dependency',
      applied: 1,
      outcome: p.outcome,
      handled: p.handled,
      run_id: latestRun,
      evidence: { dependency: p.dependency },
      probed_at: at,
    });
    addEdge('test', caseId(p.test), 'checks', 'dependency', p.dependency, {
      confidence: p.outcome === 'noticed' ? 1 : 0,
      evidence: { fault: 'dependency', outcome: p.outcome, level: 'server', route: p.route },
    });
  }

  // The gap ledger: what the detectors find in this graph, with the team's verdicts.
  const gapRow = (gap, kind, extra) => ({
    project_id: projectId,
    kind,
    detector: gap.detector,
    class: gap.class,
    key: gap.key,
    title: gap.title,
    evidence: gap.evidence,
    factors: gap.factors,
    score: gap.score,
    test_case_id: gap.test ? caseId(gap.test) : null,
    status: 'open',
    created_at: at - 30 * DAY_MS,
    updated_at: at,
    ...extra,
  });
  const gaps = [];
  for (const gap of DETECTED_GAPS) {
    const verdict = TRIAGE[`${gap.detector} ${gap.key}`];
    const extra = {};
    if (verdict?.status === 'accepted') {
      Object.assign(extra, { status: 'accepted', accepted_at: at - verdict.acceptedDaysAgo * DAY_MS });
    } else if (verdict?.status === 'snoozed') {
      Object.assign(extra, { status: 'snoozed', snoozed_until: at + verdict.snoozedForDays * DAY_MS });
    } else if (verdict?.status === 'dismissed') {
      Object.assign(extra, { status: 'dismissed', dismiss_reason: verdict.reason });
    }
    gaps.push(gapRow(gap, 'gap', extra));
  }
  for (const gap of CLOSED) {
    const daysAgo = gap.coveredDaysAgo ?? gap.closedDaysAgo;
    gaps.push(
      gapRow(gap, 'gap', {
        status: 'closed',
        closed_at: at - daysAgo * DAY_MS,
        updated_at: at - daysAgo * DAY_MS,
        ...(gap.coveredDaysAgo ? { covered_at: at - daysAgo * DAY_MS } : { closed_by_run_id: runIds[2] }),
      }),
    );
  }
  for (const finding of FINDINGS) gaps.push(gapRow(finding, 'finding', {}));

  return { nodes: [...nodes.values()], edges: [...edges.values()], probes, gaps };
}

/**
 * The requests one execution of a test makes, in order, for the network table:
 * the journey's requests with durations from their position, so the seed's
 * random stream is left untouched. Each carries the server spans the backend
 * instrumentation records: the handler on the root span, one child per dependency.
 */
export function webDashboardRequests(title) {
  const journey = WEB_DASHBOARD_JOURNEYS[title];
  if (!journey) return [];
  return journey.requests.map(([method, path, status], i) => {
    const route = `${method} ${routePattern(path)}`;
    const spec = ROUTES[route];
    const duration = 40 + ((i * 37 + path.length * 11) % 160);
    const spans = [
      {
        id: 'root',
        name: route,
        kind: 'server',
        startMs: 0,
        durMs: duration,
        status: status >= 500 ? 'error' : 'ok',
        attrs: {
          'http.method': method,
          'http.route': routePattern(path),
          'http.status_code': status,
          ...(spec ? { 'piwi.handler': spec.handler } : {}),
        },
      },
      ...(spec?.calls ?? []).map((dep, j) => ({
        id: `dep-${j}`,
        parentId: 'root',
        name: dep,
        kind: 'client',
        startMs: Math.round(duration * (0.15 + 0.25 * j)),
        durMs: Math.max(2, Math.round(duration * 0.2)),
        attrs: { 'peer.service': dep },
      })),
    ];
    return {
      method,
      url: `${WEB_DASHBOARD_ORIGIN}${path}`,
      normalizedUrl: routePattern(path),
      status,
      duration,
      resourceType: 'fetch',
      serverTraces: spans,
    };
  });
}

/** The page an execution of the test ended on, or null for a test outside the model. */
export function webDashboardFinalPage(title) {
  const pages = WEB_DASHBOARD_JOURNEYS[title]?.pages;
  return pages ? `${WEB_DASHBOARD_ORIGIN}${pages[pages.length - 1]}` : null;
}
