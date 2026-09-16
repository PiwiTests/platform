import { UnfurlProvider, type UnfurlResult } from './UnfurlProvider';
import type { LinkProvider } from '#shared/link-detect';
import type { ScmProvider, ScmEntityState } from '../scm/ScmProvider';

const EMPTY: UnfurlResult = { title: null, statusText: null, statusColor: null };

/** Map a normalized SCM entity state onto the unfurl card's status badge. */
function statusFromState(state: ScmEntityState): { statusText: string | null; statusColor: string | null } {
  switch (state) {
    case 'merged':
      return { statusText: 'Merged', statusColor: 'success' };
    case 'closed':
      return { statusText: 'Closed', statusColor: 'neutral' };
    case 'draft':
      return { statusText: 'Draft', statusColor: 'neutral' };
    case 'open':
      return { statusText: 'Open', statusColor: 'success' };
    default:
      return { statusText: null, statusColor: null };
  }
}

/** Link providers whose entity is a pull/merge request rather than an issue. */
const PR_PROVIDERS: ReadonlySet<LinkProvider> = new Set(['github-pr', 'gitlab-mr', 'bitbucket']);

/**
 * Unfurls a GitHub / GitLab / Bitbucket issue or pull/merge request through the
 * shared SCM provider, so every host is read through the one API layer in
 * `server/utils/scm/` and the card renders identically wherever the link lives.
 */
export class ScmUnfurlProvider extends UnfurlProvider {
  constructor(
    readonly provider: LinkProvider,
    private readonly scm: ScmProvider,
  ) {
    super();
  }

  async unfurl(_url: string, key: string | null): Promise<UnfurlResult> {
    const number = key ? Number(key) : NaN;
    if (!Number.isInteger(number) || number <= 0) return EMPTY;

    const entity = PR_PROVIDERS.has(this.provider)
      ? await this.scm.fetchPullRequest(number)
      : await this.scm.fetchIssue(number);
    if (!entity) return EMPTY;

    return { title: entity.title, ...statusFromState(entity.state) };
  }
}
