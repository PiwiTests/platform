import { JETBRAINS_PORTS } from '#shared/jetbrains-ports';

/**
 * The origins Open in IDE reaches from the page: a JetBrains IDE's built-in
 * server on the loopback interface (the Piwi plugin's endpoint, IDE Remote
 * Control), on the ports the IDE takes and no other.
 */
const JETBRAINS_IDE_ORIGINS = JETBRAINS_PORTS.flatMap((port) => [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
]);

/**
 * The desktop build's Content-Security-Policy (see `plugins/desktop-csp.ts`).
 * `connect-src` allows the page's own origin and the JetBrains IDE's built-in
 * server on the loopback interface, so a request can reach no other host.
 */
export function desktopContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${JETBRAINS_IDE_ORIGINS.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}
