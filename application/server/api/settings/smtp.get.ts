import { requireAuth } from '../../utils/auth';
import { getSmtpConfig } from '../../utils/email';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get SMTP configuration',
    description:
      'Returns SMTP configuration display info (host, port, from address, configured status). Password is never returned. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const cfg = getSmtpConfig();
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
