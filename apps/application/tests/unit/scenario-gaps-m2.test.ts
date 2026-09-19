import { describe, test, expect } from 'vitest';
import {
  renderScenarioDraft,
  detectControlNobodyExercises,
  detectReachableUnvisited,
  detectApiOnlyRoute,
  detectNotNoticed,
  detectOrphanTest,
  detectFixDidNotHold,
  detectPhantomCoverage,
  detectPassedWithErrors,
  detectCatalogMethodNoTestCalls,
  detectIncidentalCatch,
  detectAssertionLight,
  detectIntentWithoutTest,
  detectNewErrorPath,
  detectNewControl,
  detectLocatorBreakAhead,
} from '../../shared/handlers/scenario-gaps';

describe('detectControlNobodyExercises', () => {
  test('flags a control on pages that no test targets', () => {
    const gaps = detectControlNobodyExercises([
      { key: 'button:Export', pageCount: 12, reachCount: 0 },
      { key: 'button:Save', pageCount: 3, reachCount: 2 },
      { key: 'button:Orphan', pageCount: 0, reachCount: 0 },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.key).toBe('control:button:Export');
    expect(gaps[0]!.class).toBe('blind-spot');
    expect(gaps[0]!.evidence[0]).toContain('12 pages');
  });
});

describe('detectReachableUnvisited', () => {
  test('flags a linked but unreached page', () => {
    const gaps = detectReachableUnvisited([
      { key: '/billing', reached: false, linkedFrom: 7 },
      { key: '/cart', reached: true, linkedFrom: 4 },
      { key: '/hidden', reached: false, linkedFrom: 0 },
    ]);
    expect(gaps.map((g) => g.key)).toEqual(['page:/billing']);
    expect(gaps[0]!.evidence[0]).toContain('7 pages');
  });
});

describe('detectApiOnlyRoute', () => {
  test('flags a reached route with no trigger and no load', () => {
    const gaps = detectApiOnlyRoute([
      { key: 'POST /api/exports', reached: true, hasTrigger: false, hasLoad: false },
      { key: 'POST /api/orders', reached: true, hasTrigger: true, hasLoad: false },
      { key: 'GET /api/unused', reached: false, hasTrigger: false, hasLoad: false },
    ]);
    expect(gaps.map((g) => g.key)).toEqual(['route:POST /api/exports']);
  });
});

describe('detectNotNoticed', () => {
  test('flags a not-noticed probe on an exposed route', () => {
    const gaps = detectNotNoticed([
      {
        routeKey: 'POST /api/orders',
        noticed: false,
        notNoticed: [{ testCaseId: 1, title: 'checkout', fault: 'status-500' }],
        exposure: 3,
      },
      {
        routeKey: 'GET /api/a',
        noticed: true,
        notNoticed: [],
        exposure: 3,
      },
      {
        routeKey: 'GET /api/b',
        noticed: false,
        notNoticed: [{ testCaseId: 2, title: 'b', fault: 'empty-body' }],
        exposure: 0,
      },
    ]);
    expect(gaps.map((g) => g.key)).toEqual(['route:POST /api/orders']);
    expect(gaps[0]!.class).toBe('false-comfort');
    expect(gaps[0]!.evidence[0]).toContain('status-500');
  });

  test('two tests with opposite outcomes on one route: the route is checked, so no gap', () => {
    // A noticed and a not-noticed edge on the same route must not overwrite each
    // other nondeterministically — any noticed test means the route is checked.
    const gaps = detectNotNoticed([
      {
        routeKey: 'POST /api/orders',
        noticed: true,
        notNoticed: [{ testCaseId: 9, title: 'blind test', fault: 'status-500' }],
        exposure: 4,
      },
    ]);
    expect(gaps).toEqual([]);
  });

  test('a route no test noticed names the tests that did not', () => {
    const gaps = detectNotNoticed([
      {
        routeKey: 'POST /api/orders',
        noticed: false,
        notNoticed: [
          { testCaseId: 2, title: 'edits quantity', fault: 'status-500' },
          { testCaseId: 1, title: 'places order', fault: 'status-500' },
        ],
        exposure: 4,
      },
    ]);
    expect(gaps).toHaveLength(1);
    // Named deterministically by ascending test id, independent of input order.
    expect(gaps[0]!.evidence[0]).toContain('places order, edits quantity');
  });
});

describe('detectOrphanTest', () => {
  test('flags a test whose every node vanished', () => {
    const gaps = detectOrphanTest([
      { testCaseId: 1, title: 'old flow', reachedNodes: [{ seenRecently: false }, { seenRecently: false }] },
      { testCaseId: 2, title: 'live flow', reachedNodes: [{ seenRecently: true }, { seenRecently: false }] },
      { testCaseId: 3, title: 'no reach', reachedNodes: [] },
    ]);
    expect(gaps.map((g) => g.testCaseId)).toEqual([1]);
    expect(gaps[0]!.class).toBe('fragile');
  });
});

describe('detectFixDidNotHold', () => {
  test('reports a regressed cluster with its fix commit', () => {
    const gaps = detectFixDidNotHold([{ clusterId: 5, title: 'flaky pay', fixCommit: 'a1b2c3d4', daysSinceFix: 6 }]);
    expect(gaps[0]!.failureClusterId).toBe(5);
    expect(gaps[0]!.evidence[0]).toContain('a1b2c3d');
    expect(gaps[0]!.evidence[0]).toContain('6 days');
  });
});

describe('detectPhantomCoverage', () => {
  test('flags a long-skipped test only past the threshold', () => {
    const gaps = detectPhantomCoverage([
      { testCaseId: 1, title: 'skipped', reason: 'skipped', daysStale: 47 },
      { testCaseId: 2, title: 'recent', reason: 'skipped', daysStale: 5 },
    ]);
    expect(gaps.map((g) => g.testCaseId)).toEqual([1]);
    expect(gaps[0]!.evidence[0]).toContain('47 days');
  });
});

describe('detectPassedWithErrors', () => {
  test('reports each passing execution with an error', () => {
    const gaps = detectPassedWithErrors([
      { testCaseId: 1, title: 'checkout', detail: 'POST /api/audit returned 500 in background' },
    ]);
    expect(gaps[0]!.class).toBe('false-comfort');
    expect(gaps[0]!.evidence[0]).toContain('background');
  });
});

describe('detectCatalogMethodNoTestCalls', () => {
  test('flags an uncalled method on a reached page', () => {
    const gaps = detectCatalogMethodNoTestCalls([
      { module: './pages/CartPage', name: 'applyCoupon', callCount: 0, pageReachedBy: 4 },
      { module: './pages/CartPage', name: 'checkout', callCount: 2, pageReachedBy: 4 },
      { module: './pages/Dead', name: 'gone', callCount: 0, pageReachedBy: 0 },
    ]);
    expect(gaps.map((g) => g.key)).toEqual(['catalog:./pages/CartPage#applyCoupon']);
  });
});

describe('detectIncidentalCatch', () => {
  test('flags a cause not owned by any affected test', () => {
    const gaps = detectIncidentalCatch([
      {
        clusterId: 1,
        causeFile: 'pricing/rounding.ts',
        catcherTitle: 'checkout › happy path',
        causeInAffectedIdentity: false,
      },
      { clusterId: 2, causeFile: 'cart/coupon.ts', catcherTitle: 'cart › coupon', causeInAffectedIdentity: true },
    ]);
    expect(gaps.map((g) => g.failureClusterId)).toEqual([1]);
    expect(gaps[0]!.files).toEqual(['pricing/rounding.ts']);
  });
});

describe('detectAssertionLight', () => {
  test('flags a page reached but never data-asserted', () => {
    const gaps = detectAssertionLight([
      { pageKey: '/orders', testCount: 3, dataAssertions: 0 },
      { pageKey: '/cart', testCount: 3, dataAssertions: 2 },
      { pageKey: '/empty', testCount: 0, dataAssertions: 0 },
    ]);
    expect(gaps.map((g) => g.key)).toEqual(['page:/orders']);
  });
});

describe('detectIntentWithoutTest', () => {
  test('flags an intent no test matches', () => {
    const gaps = detectIntentWithoutTest([
      { title: 'fix: negative quantity', ticket: 'PROJ-9', matchedByTest: false },
      { title: 'add coupon field', ticket: null, matchedByTest: true },
    ]);
    expect(gaps.map((g) => g.ticket)).toEqual(['PROJ-9']);
    expect(gaps[0]!.class).toBe('blind-spot');
  });
});

describe('detectNewErrorPath', () => {
  test('reports an added status on a routed handler', () => {
    const gaps = detectNewErrorPath([
      { routeKey: 'POST /api/orders', addedStatus: 409, filePath: 'server/api/orders.post.ts' },
    ]);
    expect(gaps[0]!.key).toBe('route:POST /api/orders:409');
    expect(gaps[0]!.evidence[0]).toContain('409');
  });
});

describe('detectNewControl', () => {
  test('flags a new control only on a reached page', () => {
    const gaps = detectNewControl([
      { pageKey: '/checkout', control: 'input[name=promo]', filePath: 'Checkout.vue', pageReached: true },
      { pageKey: '/unseen', control: 'button', filePath: 'Unseen.vue', pageReached: false },
    ]);
    expect(gaps.map((g) => g.key)).toEqual(['control:/checkout:input[name=promo]']);
  });
});

describe('detectLocatorBreakAhead', () => {
  test('returns a prediction, not a gap, when call sites use the removed anchor', () => {
    const preds = detectLocatorBreakAhead([
      { removedAttr: 'data-testid=submit-order', filePath: 'Checkout.vue', callSites: ['a.spec.ts:1', 'b.spec.ts:2'] },
      { removedAttr: 'data-testid=unused', filePath: 'X.vue', callSites: [] },
    ]);
    expect(preds).toHaveLength(1);
    expect(preds[0]!.detector).toBe('locator-break-ahead');
    expect(preds[0]!.evidence).toContain('2 call sites');
  });
});

describe('renderScenarioDraft', () => {
  test('renders a skeleton with annotations, path, catalog and a TODO', () => {
    const draft = renderScenarioDraft({
      gapTitle: 'Tests pass when POST /api/orders breaks',
      gapClass: 'false-comfort',
      subject: { kind: 'route', key: 'POST /api/orders' },
      nearestTest: {
        title: 'checkout › happy path',
        feature: 'Checkout',
        priority: 'high',
        location: 'checkout.spec.ts',
      },
      path: ["await page.goto('/checkout');"],
      catalogMethods: [{ module: './pages/CartPage', name: 'placeOrder', receiver: 'cartPage' }],
      evidence: ['A probe (status-500) on POST /api/orders did not make any test fail.'],
    });
    expect(draft.text).toContain("import { test, expect } from '@playwright/test';");
    expect(draft.text).toContain('piwi:feature');
    expect(draft.text).toContain("await page.goto('/checkout');");
    expect(draft.text).toContain('cartPage.placeOrder()');
    expect(draft.text).toContain('TODO: assert the effect');
    expect(draft.annotations).toContainEqual({ type: 'piwi:feature', description: 'Checkout' });
  });

  test('notes when there is no reachable path', () => {
    const draft = renderScenarioDraft({
      gapTitle: 'x',
      gapClass: 'blind-spot',
      subject: { kind: 'route', key: 'POST /api/x' },
      nearestTest: null,
      path: [],
      catalogMethods: [],
      evidence: [],
    });
    expect(draft.text).toContain('No reached path to this gap');
  });
});
