import { describe, test, expect } from 'vitest';
import { buildRoleRouter, matchRequiredRoles, type RouteMetaEntry } from '../../server/utils/route-roles-match';

const metas: RouteMetaEntry[] = [
  { route: '/api/admin/stats', method: 'GET', meta: { openAPI: { 'x-required-roles': ['administrator'] } } },
  {
    route: '/api/projects/:id',
    method: 'GET',
    meta: { openAPI: { 'x-required-roles': ['administrator', 'reporter', 'user'] } },
  },
  { route: '/api/projects/:id', method: 'DELETE', meta: { openAPI: { 'x-required-roles': ['administrator'] } } },
  {
    route: '/api/test-run-cases/:caseId/dom-snapshot',
    method: 'GET',
    meta: { openAPI: { 'x-required-roles': ['administrator', 'reporter', 'user'] } },
  },
  {
    route: '/api/files/**:path',
    method: 'GET',
    meta: { openAPI: { 'x-required-roles': ['administrator', 'reporter', 'user'] } },
  },
  // No / empty roles → skipped (unrestricted).
  { route: '/api/health', method: 'GET', meta: { openAPI: {} } },
  { route: '/api/ai/status', method: 'GET', meta: { openAPI: { 'x-required-roles': [] } } },
  { route: '/api/no-meta', method: 'GET', meta: null },
];

const router = buildRoleRouter(metas);

describe('buildRoleRouter / matchRequiredRoles', () => {
  test('matches a static route', () => {
    expect(matchRequiredRoles(router, 'GET', '/api/admin/stats')).toEqual(['administrator']);
  });

  test('distinguishes methods on the same dynamic path', () => {
    expect(matchRequiredRoles(router, 'GET', '/api/projects/42')).toEqual(['administrator', 'reporter', 'user']);
    expect(matchRequiredRoles(router, 'DELETE', '/api/projects/42')).toEqual(['administrator']);
  });

  test('matches nested params and catch-all', () => {
    expect(matchRequiredRoles(router, 'GET', '/api/test-run-cases/3/dom-snapshot')).toEqual([
      'administrator',
      'reporter',
      'user',
    ]);
    expect(matchRequiredRoles(router, 'GET', '/api/files/a/b/c.png')).toEqual(['administrator', 'reporter', 'user']);
  });

  test('is case-insensitive on the method', () => {
    expect(matchRequiredRoles(router, 'get', '/api/admin/stats')).toEqual(['administrator']);
  });

  test('returns null for unrestricted routes (no / empty roles)', () => {
    expect(matchRequiredRoles(router, 'GET', '/api/health')).toBeNull();
    expect(matchRequiredRoles(router, 'GET', '/api/ai/status')).toBeNull();
    expect(matchRequiredRoles(router, 'GET', '/api/no-meta')).toBeNull();
  });

  test('returns null for an unknown route or wrong method', () => {
    expect(matchRequiredRoles(router, 'GET', '/api/does-not-exist')).toBeNull();
    expect(matchRequiredRoles(router, 'POST', '/api/admin/stats')).toBeNull();
  });
});
