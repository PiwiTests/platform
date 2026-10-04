import { describe, expect, test } from 'vitest';
import { desktopContentSecurityPolicy } from '../../server/utils/desktop-csp';

describe('desktopContentSecurityPolicy', () => {
  const policy = desktopContentSecurityPolicy('abc');
  const directive = (name: string) =>
    policy
      .split('; ')
      .find((d) => d.startsWith(`${name} `))
      ?.split(' ')
      .slice(1);

  test('runs only the nonced script', () => {
    expect(directive('script-src')).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
  });

  test("connects to the page's origin and to a JetBrains IDE's built-in server on loopback, nothing else", () => {
    const sources = directive('connect-src') ?? [];
    expect(sources[0]).toBe("'self'");
    const ide = sources.slice(1);
    expect(ide).toHaveLength(40);
    expect(ide).toContain('http://127.0.0.1:63342');
    expect(ide).toContain('http://localhost:63361');
    expect(ide.every((s) => /^http:\/\/(127\.0\.0\.1|localhost):633[4-6]\d$/.test(s))).toBe(true);
    expect(ide).not.toContain('http://127.0.0.1:63362');
  });
});
