import { getRequestAccess, requireAuth } from '../../utils/auth';
import { getSmtpConfig } from '../../utils/email';
import { can } from '#shared/permissions';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get SMTP configuration',
    description:
      'Returns whether SMTP is configured. Holders of `settings:manage` (administrators) also get display info (host, port, from address); everyone else only sees the configured flag. Password is never returned.',
    'x-required-permission': 'signed-in',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const cfg = getSmtpConfig();

  // Non-admins get the configured flag only — enough to know whether email
  // channels deliver, without exposing the server's mail infrastructure.
  if (!can(await getRequestAccess(event), 'settings:manage')) {
    return {
      host: null,
      port: null,
      user: null,
      from: null,
      fromName: null,
      hasPassword: false,
      secure: false,
      configured: cfg.configured,
      envManaged: true,
    };
  }

  return {
    host: cfg.host || null,
    port: cfg.port,
    user: cfg.user || null,
    from: cfg.from || null,
    fromName: cfg.fromName || null,
    hasPassword: cfg.hasPassword,
    secure: cfg.secure,
    configured: cfg.configured,
    envManaged: true,
  };
});
