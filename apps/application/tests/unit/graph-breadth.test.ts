import { describe, test, expect } from 'vitest';
import {
  templateAccessibleName,
  controlNodeKey,
  linkNodeKey,
  capPageControlKeys,
  MAX_CONTROLS_PER_PAGE,
  conventionalHandlerFile,
  requestInStepWindow,
  triggerConfidence,
  linkTargetPageKey,
  buildPageInventoryGraph,
  buildRequestGraph,
  buildTriggerEdges,
} from '../../shared/graph';

describe('templateAccessibleName', () => {
  test('collapses bare digit runs', () => {
    expect(templateAccessibleName('Order 5')).toBe('Order {n}');
    expect(templateAccessibleName('Order 12345')).toBe('Order {n}');
  });

  test('collapses ISO dates before digits', () => {
    expect(templateAccessibleName('Invoice 2026-01-02')).toBe('Invoice {date}');
    expect(templateAccessibleName('Invoice 2026-01-02T13:45:00')).toBe('Invoice {date}');
  });

  test('collapses UUIDs and long hex ids', () => {
    expect(templateAccessibleName('User 3f2c9a1b-0000-4a5b-8c7d-1234567890ab')).toBe('User {id}');
    expect(templateAccessibleName('token deadbeefcafebabe1234')).toBe('token {id}');
  });

  test('normalizes whitespace and trims', () => {
    expect(templateAccessibleName('  Place    order  ')).toBe('Place order');
  });

  test('a table of five hundred orders templates to one control', () => {
    const keys = new Set<string>();
    for (let i = 1; i <= 500; i++) keys.add(controlNodeKey('row', `Order ${i}`));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('row:Order {n}');
  });
});

describe('control and link keys', () => {
  test('control key is role:templated-name, role lower-cased', () => {
    expect(controlNodeKey('Button', 'Place order')).toBe('button:Place order');
    expect(controlNodeKey(null, 'x')).toBe('generic:x');
  });

  test('link key is link:templated-name', () => {
    expect(linkNodeKey('Order 42 details')).toBe('link:Order {n} details');
  });
});

describe('capPageControlKeys', () => {
  test('dedupes in order', () => {
    expect(capPageControlKeys(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  test('caps at MAX_CONTROLS_PER_PAGE', () => {
    const many = Array.from({ length: MAX_CONTROLS_PER_PAGE + 50 }, (_, i) => `c${i}`);
    expect(capPageControlKeys(many)).toHaveLength(MAX_CONTROLS_PER_PAGE);
  });

  test('a smaller custom cap is honored', () => {
    expect(capPageControlKeys(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
});

describe('conventionalHandlerFile', () => {
  test('constructs a Nitro handler with a method suffix', () => {
    expect(conventionalHandlerFile('POST /api/orders')).toBe('server/api/orders.post.ts');
  });

  test('turns :id placeholders into [id] segments', () => {
    expect(conventionalHandlerFile('PATCH /api/orders/:id')).toBe('server/api/orders/[id].patch.ts');
    expect(conventionalHandlerFile('GET /api/users/:uuid/roles')).toBe('server/api/users/[uuid]/roles.get.ts');
  });

  test('returns null for a root path', () => {
    expect(conventionalHandlerFile('GET /')).toBeNull();
  });
});

describe('requestInStepWindow', () => {
  const step = { startedAt: 1000, duration: 200 };

  test('a request inside the window counts', () => {
    expect(requestInStepWindow(1100, step)).toBe(true);
    expect(requestInStepWindow(1000, step)).toBe(true);
    expect(requestInStepWindow(1200, step)).toBe(true);
  });

  test('the pad absorbs a request just before or after', () => {
    expect(requestInStepWindow(970, step)).toBe(true); // 30ms before start, within 50ms pad
    expect(requestInStepWindow(1240, step)).toBe(true); // 40ms after end, within pad
  });

  test('a request well outside the window does not count', () => {
    expect(requestInStepWindow(500, step)).toBe(false);
    expect(requestInStepWindow(2000, step)).toBe(false);
  });

  test('a missing request start does not count', () => {
    expect(requestInStepWindow(null, step)).toBe(false);
    expect(requestInStepWindow(undefined, step)).toBe(false);
  });
});

describe('triggerConfidence', () => {
  test('is the share of executions where the pair held', () => {
    expect(triggerConfidence(3, 4)).toBe(0.75);
    expect(triggerConfidence(4, 4)).toBe(1);
    expect(triggerConfidence(0, 4)).toBe(0);
  });

  test('zero executions is zero', () => {
    expect(triggerConfidence(1, 0)).toBe(0);
  });
});

describe('linkTargetPageKey', () => {
  const origins = new Set(['https://app.example.com']);

  test('resolves an own-origin absolute href to its page key', () => {
    expect(linkTargetPageKey('https://app.example.com/orders/42', origins)).toBe('/orders/:id');
  });

  test('resolves a relative href against the page', () => {
    expect(linkTargetPageKey('/checkout', origins, '/cart')).toBe('/checkout');
  });

  test('drops an off-origin absolute href', () => {
    expect(linkTargetPageKey('https://evil.example.com/x', origins)).toBeNull();
  });

  test('drops fragment, mailto, tel and javascript hrefs', () => {
    expect(linkTargetPageKey('#section', origins)).toBeNull();
    expect(linkTargetPageKey('mailto:a@b.com', origins)).toBeNull();
    expect(linkTargetPageKey('tel:123', origins)).toBeNull();
    expect(linkTargetPageKey('javascript:void(0)', origins)).toBeNull();
  });
});

describe('buildPageInventoryGraph', () => {
  test('produces control/link/page nodes and contains/links edges, capped', () => {
    const origins = new Set(['https://app.example.com']);
    const { nodes, edges } = buildPageInventoryGraph(
      [
        {
          pageKey: '/cart',
          controls: [
            { role: 'button', name: 'Apply coupon' },
            { role: 'row', name: 'Order 1' },
            { role: 'row', name: 'Order 2' },
          ],
          links: [{ name: 'Checkout', href: 'https://app.example.com/checkout' }],
        },
      ],
      { origins },
    );
    const controlKeys = nodes
      .filter((n) => n.kind === 'control')
      .map((n) => n.key)
      .sort();
    expect(controlKeys).toEqual(['button:Apply coupon', 'row:Order {n}']);
    expect(nodes.some((n) => n.kind === 'link' && n.key === 'link:Checkout')).toBe(true);
    expect(nodes.some((n) => n.kind === 'page' && n.key === '/checkout')).toBe(true);
    expect(edges.some((e) => e.kind === 'contains' && e.toKind === 'control')).toBe(true);
    expect(edges.some((e) => e.kind === 'links' && e.toKey === '/checkout')).toBe(true);
  });

  test('emits loads edges for the page routes', () => {
    const { edges } = buildPageInventoryGraph([
      { pageKey: '/cart', controls: [], links: [], loadsRouteKeys: ['GET /api/cart'] },
    ]);
    expect(edges).toContainEqual(
      expect.objectContaining({ kind: 'loads', fromKey: '/cart', toKind: 'route', toKey: 'GET /api/cart' }),
    );
  });

  test('resolves a relative href against the page’s real URL, not the placeholder root', () => {
    const origins = new Set(['https://app.example.com']);
    const { edges } = buildPageInventoryGraph(
      [
        {
          pageKey: '/orders/:id',
          pageUrl: 'https://app.example.com/orders/42',
          controls: [],
          links: [{ name: 'Details', href: 'details' }],
        },
      ],
      { origins },
    );
    // `<a href="details">` on /orders/42 resolves under /orders, not to /details.
    expect(edges.some((e) => e.kind === 'links' && e.toKey === '/orders/details')).toBe(true);
    expect(edges.some((e) => e.kind === 'links' && e.toKey === '/details')).toBe(false);
  });
});

describe('buildRequestGraph', () => {
  test('uses the observed handler when present', () => {
    const { nodes, edges } = buildRequestGraph([
      { routeKey: 'POST /api/orders', handlerFile: 'server/api/orders.post.ts', dependencies: ['payments-svc', 'DB'] },
    ]);
    const handledBy = edges.find((e) => e.kind === 'handled-by');
    expect(handledBy?.origin).toBe('observed');
    expect(handledBy?.toKey).toBe('server/api/orders.post.ts');
    expect(edges.filter((e) => e.kind === 'calls')).toHaveLength(2);
    expect(nodes.some((n) => n.kind === 'dependency' && n.key === 'payments-svc')).toBe(true);
  });

  test('falls back to the convention, labeled', () => {
    const { edges } = buildRequestGraph([{ routeKey: 'PATCH /api/orders/:id', dependencies: [] }]);
    const handledBy = edges.find((e) => e.kind === 'handled-by');
    expect(handledBy?.origin).toBe('convention');
    expect(handledBy?.toKey).toBe('server/api/orders/[id].patch.ts');
  });
});

describe('buildTriggerEdges', () => {
  test('confidence is the share of executions where the pair held', () => {
    const edges = buildTriggerEdges([
      [{ controlKey: 'button:Place order', routeKey: 'POST /api/orders' }],
      [{ controlKey: 'button:Place order', routeKey: 'POST /api/orders' }],
      [{ controlKey: 'button:Place order', routeKey: 'POST /api/orders' }],
      [],
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.confidence).toBe(0.75);
    expect(edges[0]!.fromKey).toBe('button:Place order');
    expect(edges[0]!.toKey).toBe('POST /api/orders');
  });

  test('a pair is counted at most once per execution', () => {
    const edges = buildTriggerEdges([
      [
        { controlKey: 'c', routeKey: 'r' },
        { controlKey: 'c', routeKey: 'r' },
      ],
    ]);
    expect(edges[0]!.confidence).toBe(1);
  });
});
