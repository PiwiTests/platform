import { describe, it, expect } from 'vitest';
import { HIDDEN_VALUE, mockCode, mockFileName, mockUrlPattern } from '../../src/shared/mock-code.js';

const cart = {
  method: 'GET',
  url: 'https://shop.test/api/cart',
  status: 200,
  mimeType: 'application/json; charset=utf-8',
  body: JSON.stringify({ items: [{ sku: 'SPRING-TEE', qty: 1 }], total: 40 }),
};

describe('mockUrlPattern', () => {
  it('keeps the path and drops the origin', () => {
    expect(mockUrlPattern('https://shop.test/api/cart')).toBe('**/api/cart');
  });

  it('keeps the query, with the volatile values as a wildcard', () => {
    expect(mockUrlPattern('https://shop.test/api/cart?page=2&_=1695820800000')).toBe('**/api/cart?page=2&_=*');
    expect(mockUrlPattern('https://shop.test/api/items?q=tee&v=6f1c2d3e4a5b6c7d8e9f')).toBe('**/api/items?q=tee&v=*');
    expect(mockUrlPattern('https://shop.test/api/items?flag')).toBe('**/api/items?flag');
  });

  it('turns glob characters of the URL into wildcards', () => {
    expect(mockUrlPattern('https://shop.test/api/items?filter={a}')).toBe('**/api/items?filter=*a*');
  });
});

describe('mockFileName', () => {
  it('names the file after the last path segment, with its parent for an id', () => {
    expect(mockFileName('https://shop.test/api/cart')).toBe('cart');
    expect(mockFileName('https://shop.test/api/orders/42/')).toBe('orders-42');
    expect(mockFileName('https://shop.test/')).toBe('response');
    expect(mockFileName('https://shop.test/assets/data.json')).toBe('data');
  });
});

describe('mockCode', () => {
  it('fulfills a JSON body with json', () => {
    expect(mockCode(cart).code).toBe(
      [
        "await page.route('**/api/cart', (route) =>",
        '  route.fulfill({',
        '    json: {',
        '      "items": [',
        '        {',
        '          "sku": "SPRING-TEE",',
        '          "qty": 1',
        '        }',
        '      ],',
        '      "total": 40',
        '    },',
        '  }),',
        ');',
      ].join('\n'),
    );
  });

  it('adds the status when it is not 200, and a method check when it is not GET', () => {
    const { code } = mockCode({ ...cart, method: 'post', status: 201, body: '{"id":7}' });
    expect(code).toContain("if (route.request().method() !== 'POST') return route.fallback();");
    expect(code).toContain('status: 201, json: {');
  });

  it('fulfills any other body with its content type', () => {
    const { code } = mockCode({ ...cart, mimeType: 'text/html', body: "<p>It's here</p>\n" });
    expect(code).toContain("route.fulfill({ contentType: 'text/html', body: '<p>It\\'s here</p>\\n' })");
    const binary = mockCode({ ...cart, mimeType: 'image/png', body: 'iVBORw0KGgo=', base64: true });
    expect(binary.code).toContain("body: Buffer.from('iVBORw0KGgo=', 'base64')");
  });

  it('hides credentials unless asked to reveal them', () => {
    const body = JSON.stringify({ user: { name: 'Ada', accessToken: 'abc', password: 'p' }, sessionId: 5 });
    const hidden = mockCode({ ...cart, body });
    expect(hidden.hidden).toBe(3);
    expect(hidden.code).toContain(`"accessToken": "${HIDDEN_VALUE}"`);
    expect(hidden.code).toContain(`"sessionId": "${HIDDEN_VALUE}"`);
    expect(hidden.code).toContain('"name": "Ada"');
    const revealed = mockCode({ ...cart, body }, { reveal: true });
    expect(revealed.hidden).toBe(0);
    expect(revealed.code).toContain('"accessToken": "abc"');
    const form = mockCode({ ...cart, mimeType: 'application/x-www-form-urlencoded', body: 'user=ada&password=p' });
    expect(form.code).toContain('user=ada&password=%3Chidden%3E');
  });

  it('writes a large body to a file the code reads', () => {
    const big = { ...cart, body: JSON.stringify({ rows: Array.from({ length: 50 }, (_, i) => ({ i })) }) };
    const result = mockCode(big, { maxInlineBody: 100 });
    expect(result.code).toBe(
      "await page.route('**/api/cart', (route) =>\n  route.fulfill({ contentType: 'application/json', path: 'mocks/cart.json' }),\n);",
    );
    expect(JSON.parse(result.file!.content).rows).toHaveLength(50);
  });

  it('writes an error or a network failure for the same route', () => {
    expect(mockCode(cart, { kind: 'error' }).code).toBe(
      "await page.route('**/api/cart', (route) =>\n  route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }),\n);",
    );
    expect(mockCode(cart, { kind: 'abort', pattern: '**/api/*' }).code).toBe(
      "await page.route('**/api/*', (route) =>\n  route.abort(),\n);",
    );
  });
});
