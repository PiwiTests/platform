import { requireAuth } from '../../../utils/auth';
import { claudeCliEnabled, runClaudeLogout } from '../../../utils/ai-claude-cli';

defineRouteMeta({
  openAPI: {
    tags: ['AI'],
    summary: 'Sign out of the local Claude CLI',
    description: 'Runs `claude auth logout`. Desktop app only. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  if (!claudeCliEnabled()) {
    throw apiError({ statusCode: 400, message: 'The local Claude CLI is only available in the Piwi desktop app' });
  }

  const result = await runClaudeLogout();
  if (!result.success) {
    throw apiError({ statusCode: 500, message: result.error || 'Sign-out failed' });
  }
  return { success: true };
});
