import { requireAuth } from '../../utils/auth';
import { getSmtpConfig } from '../../utils/email';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get SMTP configuration',
    description:
      'Returns whether SMTP is configured. Administrators also get display info (host, port, from address); other roles only see the configured flag. Password is never returned.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const cfg = getSmtpConfig();

  // Non-admins get the configured flag only — enough to know whether email
  // channels deliver, without exposing the server's mail infrastructure.
  if (user.role !== Role.ADMINISTRATOR) {
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
