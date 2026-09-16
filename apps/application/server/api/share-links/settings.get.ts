import { requireAuth } from '../../utils/auth';
import { resolveShareLinkMaxTtlDays, shareLinksEnabled } from '../../utils/share-links';

defineRouteMeta({
  openAPI: {
    tags: ['Share Links'],
    summary: 'Share-link settings',
    description:
      'Whether share links are enabled on this instance, and the longest allowed link lifetime in days (0 = links may be minted without an expiry).',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  return { enabled: shareLinksEnabled(), maxTtlDays: resolveShareLinkMaxTtlDays() };
});
