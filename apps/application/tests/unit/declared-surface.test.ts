import { describe, test, expect } from 'vitest';
import { buildManifestGraph, normalizeManifestPattern, extractImports, buildImportEdges } from '#shared/graph';
import { parseOpenApiSpec } from '#shared/openapi';
import { detectDeclaredNeverHit, detectSuccessOnly, type RouteStat } from '#shared/handlers/scenario-gaps';

describe('normalizeManifestPattern', () => {
  test('collapses framework placeholders to :id / :uuid', () => {
    expect(normalizeManifestPattern('/api/orders/:id')).toBe('/api/orders/:id');
    expect(normalizeManifestPattern('/api/orders/{orderId}')).toBe('/api/orders/:id');
    expect(normalizeManifestPattern('/api/orders/[id]')).toBe('/api/orders/:id');
    expect(normalizeManifestPattern('/api/users/{userUuid}')).toBe('/api/users/:uuid');
    expect(normalizeManifestPattern('/api/orders/:id?expand=1')).toBe('/api/orders/:id');
  });

  test('leaves static segments untouched', () => {
    expect(normalizeManifestPattern('api/cart')).toBe('/api/cart');
  });
});

describe('buildManifestGraph', () => {
  test('builds declared route/handler nodes with documented codes and origin', () => {
    const { nodes, edges } = buildManifestGraph(
      {
        routes: [
          {
            method: 'delete',
            pattern: '/api/orders/{id}',
            handler: 'server/api/orders/[id].delete.ts',
            responses: [200, 404, 409, 200],
          },
        ],
        pages: [{ pattern: '/orders/{id}', name: 'Order detail' }],
      },
      'openapi',
    );
    const route = nodes.find((n) => n.kind === 'route');
    expect(route?.key).toBe('DELETE /api/orders/:id');
    expect(route?.origin).toBe('openapi');
    const routeAttrs = route?.attrs as { responses: number[] } | undefined;
    expect(routeAttrs?.responses).toEqual([200, 404, 409]);
    const page = nodes.find((n) => n.kind === 'page');
    expect(page?.key).toBe('/orders/:id');
    const pageAttrs = page?.attrs as { name?: string } | undefined;
    expect(pageAttrs?.name).toBe('Order detail');
    const handledBy = edges.find((e) => e.kind === 'handled-by');
    expect(handledBy?.toKey).toBe('server/api/orders/[id].delete.ts');
    expect(handledBy?.origin).toBe('openapi');
  });

  test('a committed manifest is origin manifest', () => {
    const { nodes } = buildManifestGraph({ routes: [{ method: 'GET', pattern: '/api/cart' }] }, 'committed');
    expect(nodes[0]?.origin).toBe('manifest');
  });
});

describe('parseOpenApiSpec', () => {
  test('one route per path × method with documented codes', () => {
    const manifest = parseOpenApiSpec({
      paths: {
        '/orders/{id}': {
          get: { responses: { '200': {}, '404': {} } },
          delete: { responses: { '204': {}, '409': {}, default: {} } },
          parameters: [],
        },
      },
    });
    const routes = manifest.routes ?? [];
    expect(routes).toHaveLength(2);
    const del = routes.find((r) => r.method === 'DELETE');
    expect(del?.pattern).toBe('/orders/{id}');
    expect(del?.responses).toEqual([204, 409]);
  });

  test('malformed input yields an empty manifest', () => {
    expect(parseOpenApiSpec(null).routes).toEqual([]);
    expect(parseOpenApiSpec({ paths: 'nope' }).routes).toEqual([]);
  });
});

describe('extractImports / buildImportEdges', () => {
  const known = new Set(['src/api/orders.post.ts', 'src/lib/pricing.ts', 'src/lib/db/index.ts']);

  test('resolves relative imports to known files, drops aliases and bare specifiers', () => {
    const content = [
      "import { price } from '../lib/pricing';",
      "import { db } from '../lib/db';",
      "import { z } from 'zod';",
      "import cfg from '#shared/config';",
      "const x = require('../outside/thing');",
    ].join('\n');
    const imports = extractImports('src/api/orders.post.ts', content, known);
    expect(imports).toContain('src/lib/pricing.ts');
    expect(imports).toContain('src/lib/db/index.ts');
    expect(imports).not.toContain('zod');
  });

  test('buildImportEdges makes file nodes and imports edges with origin import', () => {
    const { nodes, edges } = buildImportEdges([{ from: 'src/a.ts', to: 'src/b.ts' }]);
    expect(nodes.every((n) => n.kind === 'file' && n.origin === 'import')).toBe(true);
    expect(edges[0]).toMatchObject({ fromKey: 'src/a.ts', toKey: 'src/b.ts', kind: 'imports', origin: 'import' });
  });
});

describe('detectDeclaredNeverHit', () => {
  test('flags an unreached declared route and names its documented codes', () => {
    const gaps = detectDeclaredNeverHit([
      {
        nodeKind: 'route',
        nodeKey: 'DELETE /api/orders/:id',
        origin: 'openapi',
        reachCount: 0,
        documentedCodes: [200, 404, 409],
      },
      { nodeKind: 'route', nodeKey: 'GET /api/cart', origin: 'manifest', reachCount: 3 },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.detector).toBe('declared-never-hit');
    expect(gaps[0]!.class).toBe('blind-spot');
    expect(gaps[0]!.evidence[0]).toContain('Declared in OpenAPI');
    expect(gaps[0]!.evidence[0]).toContain('200, 404, 409');
  });
});

describe('detectSuccessOnly with documented codes', () => {
  const base: RouteStat = { key: 'GET /api/cart', method: 'GET', pattern: '/api/cart', count: 412, statuses: [200] };

  test('names documented error codes never returned under test', () => {
    const gaps = detectSuccessOnly([{ ...base, documentedCodes: [200, 401, 409] }]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.title).toContain('401/409');
    expect(gaps[0]!.evidence.some((e) => e.includes('Documents 401, 409'))).toBe(true);
  });

  test('a route with no documented error codes reads as the plain success-only gap', () => {
    const gaps = detectSuccessOnly([base]);
    expect(gaps[0]!.title).toBe('GET /api/cart: no error path under test');
    expect(gaps[0]!.evidence).toHaveLength(1);
  });
});
