import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { EditorSendPayload } from '@piwitests/core/editor-send';
import { startSendListener, type SendListener } from '../src/send-listener';
import { indentBlock } from '../src/glue';

const TOKEN = 'abcdefghijklmnop_1234';
const received: EditorSendPayload[] = [];
let listener: SendListener;

beforeAll(async () => {
  listener = await startSendListener({
    port: 0,
    token: () => TOKEN,
    onPayload: async (payload) => {
      received.push(payload);
      return { inserted: true, file: '/w/tests/a.spec.ts' };
    },
  });
});

afterAll(() => listener.close());

const send = (body: unknown, token = TOKEN, origin = 'chrome-extension://abc') =>
  fetch(listener.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: origin },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('the send listener', () => {
  test('listens on the loopback interface', () => {
    expect(listener.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/piwi\/send$/);
  });

  test('hands a paired request’s payload to the extension', async () => {
    const res = await send({ kind: 'locator', text: "page.getByRole('button', { name: 'Pay' })" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: true, file: '/w/tests/a.spec.ts' });
    expect(res.headers.get('access-control-allow-origin')).toBe('chrome-extension://abc');
    expect(received).toEqual([{ kind: 'locator', text: "page.getByRole('button', { name: 'Pay' })" }]);
  });

  test('refuses a wrong token, a bad body and another path', async () => {
    expect((await send({ kind: 'locator', text: 'x' }, 'wrong-token-wrong-token')).status).toBe(401);
    expect((await send('{')).status).toBe(400);
    expect((await send({ kind: 'file' })).status).toBe(400);
    expect((await fetch(listener.url.replace('/piwi/send', '/other'), { method: 'POST' })).status).toBe(404);
    expect(received).toHaveLength(1);
  });

  test('answers the preflight, and never names a web page as an allowed origin', async () => {
    const res = await fetch(listener.url, { method: 'OPTIONS', headers: { Origin: 'moz-extension://x' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');
    const page = await fetch(listener.url, { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } });
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('a taken port is refused rather than replaced', async () => {
    await expect(
      startSendListener({
        port: listener.port,
        token: () => TOKEN,
        onPayload: async () => ({ inserted: false, file: null }),
      }),
    ).rejects.toThrow(/EADDRINUSE/);
  });
});

describe('indentBlock', () => {
  test('re-indents a rendered body at the cursor’s indentation', () => {
    expect(indentBlock("  await page.goto('/cart');\n  await page.getByRole('button').click();\n", '    ')).toBe(
      "await page.goto('/cart');\n    await page.getByRole('button').click();",
    );
    expect(indentBlock('a\n\n  b', '')).toBe('a\n\n  b');
  });
});
