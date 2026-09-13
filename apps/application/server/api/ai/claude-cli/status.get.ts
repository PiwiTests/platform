import { requireAuth } from '../../../utils/auth';
import { getClaudeCliStatus } from '../../../utils/ai-claude-cli';
import { queryFlag } from '../../../utils/query-params';

defineRouteMeta({
  openAPI: {
    tags: ['AI'],
    summary: 'Local Claude CLI status',
    description:
      'Reports whether the local `claude` CLI (Claude Code) is installed, its version, whether it is signed in, and the running usage tally. Desktop app only. Pass `?refresh=true` to bypass the short status cache. Requires administrator role.',
    parameters: [{ name: 'refresh', in: 'query', required: false, schema: { type: 'boolean' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  return getClaudeCliStatus({ force: queryFlag(event, 'refresh') });
});
