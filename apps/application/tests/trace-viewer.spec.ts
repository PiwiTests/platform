/**
 * The bundled Playwright trace viewer must be served at /trace-viewer/.
 * Its files come from playwright-core via a nitro publicAssets entry, and
 * Nitro silently skips a missing assets dir — a wrong path surfaces only as
 * 404s at runtime, never as a build error.
 */
import { test, expect } from './fixtures';

test.describe('Bundled trace viewer', () => {
  test('serves the viewer page', async ({ request }) => {
    const response = await request.get('/trace-viewer/index.html');
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('<html');
  });

  test('serves the service worker the viewer loads traces through', async ({ request }) => {
    const response = await request.get('/trace-viewer/sw.bundle.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
  });
});
