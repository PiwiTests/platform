import type { TestCaseResult } from '~~/types/api';
import type { RetryCase, RetryMode } from '~/utils/retry-command';
import { buildRetryCommand } from '~/utils/retry-command';

/**
 * The run page's retry command, derived once from the run's execution rows so
 * every "Copy retry command" button on the page copies the same command for the
 * same failing set. The mode is page-level state shared by all callers.
 *
 * The failing set is one row per test and Playwright project: the final
 * attempt (highest retry index) when its status is failed or timed out, so a
 * test that passed on retry is never re-run. File, line and project come from
 * the row itself, which makes the command exact.
 */
export function useRunRetryCommand(testCases: MaybeRefOrGetter<TestCaseResult[] | null | undefined>) {
  const mode = useState<RetryMode>('run-retry-mode', () => 'file-line');

  const failedCases = computed<RetryCase[]>(() => {
    const finalAttempt = new Map<string, TestCaseResult>();
    for (const tc of toValue(testCases) ?? []) {
      const projectName = (tc.browser as { projectName?: string } | null)?.projectName ?? '';
      const key = `${tc.testCaseId ?? tc.location ?? tc.title}|${projectName}`;
      const prev = finalAttempt.get(key);
      if (!prev || (tc.retries ?? 0) > (prev.retries ?? 0)) finalAttempt.set(key, tc);
    }
    return [...finalAttempt.values()]
      .filter((tc) => tc.status === 'failed' || tc.status === 'timedout' || tc.status === 'timedOut')
      .map((tc) => ({
        filePath: (tc.filePath || tc.location?.split(':')[0]) ?? '',
        title: tc.title,
        line: tc.location ? parseInt(tc.location.split(':')[1] ?? '', 10) || null : null,
        projectName: (tc.browser as { projectName?: string } | null)?.projectName || null,
      }));
  });

  const command = computed(() => buildRetryCommand(failedCases.value, { mode: mode.value }));

  const { copy, copied } = useCopy();
  function copyCommand() {
    if (command.value) copy(command.value, { toast: 'Retry command copied' });
  }

  const title = computed(() => (copied.value ? 'Copied!' : copyPreview(command.value)));

  return { mode, failedCases, command, copyCommand, copied, title };
}
