import { describe, test, expect } from 'vitest';
import {
  buildPermissionRouter,
  matchRequiredPermissions,
  type RouteMetaEntry,
} from '../../server/utils/route-permission-match';

const metas: RouteMetaEntry[] = [
  { route: '/api/admin/stats', method: 'GET', meta: { openAPI: { 'x-required-permission': 'settings:manage' } } },
  { route: '/api/projects/:id', method: 'GET', meta: { openAPI: { 'x-required-permission': 'project:read' } } },
  { route: '/api/projects/:id', method: 'DELETE', meta: { openAPI: { 'x-required-permission': 'project:delete' } } },
  {
    route: '/api/test-run-cases/:caseId/dom-snapshot',
    method: 'GET',
    meta: { openAPI: { 'x-required-permission': 'project:read' } },
  },
  { route: '/api/files/**:path', method: 'GET', meta: { openAPI: { 'x-required-permission': 'project:read' } } },
  {
    route: '/api/projects/:id/quarantine',
    method: 'POST',
    meta: { openAPI: { 'x-required-permission': ['quarantine:write', 'triage:write'] } },
  },
  { route: '/api/auth/change-password', method: 'POST', meta: { openAPI: { 'x-required-permission': 'signed-in' } } },
  // Nothing declared, an empty list, or no valid permission: skipped (public or token-authenticated).
  { route: '/api/health', method: 'GET', meta: { openAPI: {} } },
  { route: '/api/ai/status', method: 'GET', meta: { openAPI: { 'x-required-permission': [] } } },
  { route: '/api/legacy', method: 'GET', meta: { openAPI: { 'x-required-permission': ['administrator'] } } },
  { route: '/api/no-meta', method: 'GET', meta: null },
];

const router = buildPermissionRouter(metas);

describe('buildPermissionRouter / matchRequiredPermissions', () => {
  test('matches a static route and normalizes a single permission to a list', () => {
    expect(matchRequiredPermissions(router, 'GET', '/api/admin/stats')).toEqual(['settings:manage']);
    expect(matchRequiredPermissions(router, 'POST', '/api/auth/change-password')).toEqual(['signed-in']);
  });

  test('keeps a list of permissions, any one of them being enough', () => {
    expect(matchRequiredPermissions(router, 'POST', '/api/projects/7/quarantine')).toEqual([
      'quarantine:write',
      'triage:write',
    ]);
  });

  test('distinguishes methods on the same dynamic path', () => {
    expect(matchRequiredPermissions(router, 'GET', '/api/projects/42')).toEqual(['project:read']);
    expect(matchRequiredPermissions(router, 'DELETE', '/api/projects/42')).toEqual(['project:delete']);
  });

  test('matches nested params and catch-all', () => {
    expect(matchRequiredPermissions(router, 'GET', '/api/test-run-cases/3/dom-snapshot')).toEqual(['project:read']);
    expect(matchRequiredPermissions(router, 'GET', '/api/files/a/b/c.png')).toEqual(['project:read']);
  });

  test('is case-insensitive on the method', () => {
    expect(matchRequiredPermissions(router, 'get', '/api/admin/stats')).toEqual(['settings:manage']);
  });

  test('returns an empty list for a route declaring no permission', () => {
    expect(matchRequiredPermissions(router, 'GET', '/api/health')).toEqual([]);
    expect(matchRequiredPermissions(router, 'GET', '/api/ai/status')).toEqual([]);
    expect(matchRequiredPermissions(router, 'GET', '/api/legacy')).toEqual([]);
    expect(matchRequiredPermissions(router, 'GET', '/api/no-meta')).toEqual([]);
  });

  test('returns an empty list for an unknown route or wrong method', () => {
    expect(matchRequiredPermissions(router, 'GET', '/api/does-not-exist')).toEqual([]);
    expect(matchRequiredPermissions(router, 'POST', '/api/admin/stats')).toEqual([]);
  });
});
