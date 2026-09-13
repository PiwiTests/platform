import { describe, test, expect } from 'vitest';
import {
  DEFAULT_PROJECT_INTEGRATION,
  resolveProjectIntegration,
  pickOwnerRoute,
  normalizeOwner,
  type OwnerRoute,
} from '../../shared/integrations/binding';

describe('resolveProjectIntegration', () => {
  test('empty input yields the documented defaults', () => {
    expect(resolveProjectIntegration()).toEqual(DEFAULT_PROJECT_INTEGRATION);
    expect(resolveProjectIntegration(null)).toEqual(DEFAULT_PROJECT_INTEGRATION);
    expect(resolveProjectIntegration({})).toEqual(DEFAULT_PROJECT_INTEGRATION);
  });

  test('every policy is off and auto-create disabled by default', () => {
    const { policies, autoCreate } = resolveProjectIntegration({});
    expect(policies.commentOnFix).toBe(false);
    expect(policies.transitionOnFix).toBe(false);
    expect(policies.commentOnRegression).toBe(false);
    expect(policies.resolveOnClose).toBe(false);
    expect(policies.reopenOnTicketReopen).toBe(false);
    expect(policies.commentOnMerge).toBe(false);
    expect(policies.commentOnNewOccurrences).toBe(false);
    expect(policies.needsTicketAfterDays).toBe(2);
    expect(autoCreate.enabled).toBe(false);
    expect(autoCreate.minOccurrences).toBe(2);
    expect(autoCreate.minRuns).toBe(2);
    expect(autoCreate.dailyCap).toBe(5);
  });

  test('include defaults to diagnosis + patch on, screenshot + share link off', () => {
    expect(resolveProjectIntegration({}).include).toEqual({
      includeDiagnosis: true,
      includePatch: true,
      includeScreenshot: false,
      includeShareLink: false,
    });
  });

  test('scalars are trimmed and connectionId must be a positive integer', () => {
    const r = resolveProjectIntegration({
      connectionId: 7,
      projectKey: '  PROJ  ',
      issueType: ' 10001 ',
      defaultAssignee: '  acct-1  ',
    });
    expect(r.connectionId).toBe(7);
    expect(r.projectKey).toBe('PROJ');
    expect(r.issueType).toBe('10001');
    expect(r.defaultAssignee).toBe('acct-1');
    expect(resolveProjectIntegration({ connectionId: 0 }).connectionId).toBeNull();
    expect(resolveProjectIntegration({ connectionId: -3 }).connectionId).toBeNull();
    expect(resolveProjectIntegration({ connectionId: 1.5 }).connectionId).toBeNull();
  });

  test('labels are trimmed, de-duped and empties dropped', () => {
    expect(resolveProjectIntegration({ labels: [' a ', 'a', '', 'b'] as string[] }).labels).toEqual(['a', 'b']);
  });

  test('locale is narrowed to a supported language, else null (inherit)', () => {
    expect(resolveProjectIntegration({ locale: 'fr' }).locale).toBe('fr');
    expect(resolveProjectIntegration({ locale: 'de' as never }).locale).toBeNull();
    expect(resolveProjectIntegration({ locale: null }).locale).toBeNull();
  });

  test('numeric guards clamp to their ranges', () => {
    const r = resolveProjectIntegration({
      policies: { needsTicketAfterDays: 9999 } as never,
      autoCreate: { minOccurrences: 0, dailyCap: -5 } as never,
    });
    expect(r.policies.needsTicketAfterDays).toBe(365);
    expect(r.autoCreate.minOccurrences).toBe(1);
    expect(r.autoCreate.dailyCap).toBe(0);
  });

  test('owner routes require an owner and normalize their fields', () => {
    const routes = resolveProjectIntegration({
      ownerRoutes: [
        { owner: '  @acme/checkout  ', projectKey: ' CHK ', labels: [' x ', 'x'] },
        { owner: '', projectKey: 'NOPE' },
        { projectKey: 'ALSO-NOPE' } as never,
      ],
    }).ownerRoutes;
    expect(routes).toHaveLength(1);
    expect(routes[0]).toEqual({
      owner: '@acme/checkout',
      projectKey: 'CHK',
      componentId: null,
      assigneeAccountId: null,
      labels: ['x'],
    });
  });

  test('transition ids round-trip when their policy is on', () => {
    const r = resolveProjectIntegration({
      policies: { transitionOnFix: true, fixTransitionId: '31', reopenTransitionId: '41' } as never,
    });
    expect(r.policies.transitionOnFix).toBe(true);
    expect(r.policies.fixTransitionId).toBe('31');
    expect(r.policies.reopenTransitionId).toBe('41');
  });
});

describe('pickOwnerRoute', () => {
  const routes: OwnerRoute[] = [
    { owner: '@acme/checkout', projectKey: 'CHK' },
    { owner: 'alice@example.com', projectKey: 'ALICE' },
  ];

  test('matches ignoring case and a leading @', () => {
    expect(pickOwnerRoute(routes, '@acme/checkout')?.projectKey).toBe('CHK');
    expect(pickOwnerRoute(routes, 'acme/checkout')?.projectKey).toBe('CHK');
    expect(pickOwnerRoute(routes, '@ACME/Checkout')?.projectKey).toBe('CHK');
    expect(pickOwnerRoute(routes, 'alice@example.com')?.projectKey).toBe('ALICE');
  });

  test('returns the first matching route in priority order', () => {
    const dup: OwnerRoute[] = [
      { owner: '@team', projectKey: 'FIRST' },
      { owner: '@team', projectKey: 'SECOND' },
    ];
    expect(pickOwnerRoute(dup, '@team')?.projectKey).toBe('FIRST');
  });

  test('null owner or no match yields null', () => {
    expect(pickOwnerRoute(routes, null)).toBeNull();
    expect(pickOwnerRoute(routes, '')).toBeNull();
    expect(pickOwnerRoute(routes, '@acme/payments')).toBeNull();
  });

  test('normalizeOwner strips @ and lower-cases', () => {
    expect(normalizeOwner('@Acme/Checkout')).toBe('acme/checkout');
  });
});
