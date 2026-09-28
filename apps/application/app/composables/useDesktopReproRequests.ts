/**
 * Desktop shell: the repro requests Piwi Picker sent and the developer has not
 * answered yet, oldest first. The desktop event stream delivers each one as a
 * `repro-request` message (the ones still waiting arrive again on every
 * connection); the confirmation dialog shows the first and drops it once run,
 * declined or expired.
 */
import type { ReproRequestView } from '#shared/desktop-repro';

export function useDesktopReproRequests() {
  const queue = useState<ReproRequestView[]>('desktop-repro-requests', () => []);

  function add(request: ReproRequestView) {
    if (request.status !== 'waiting' || queue.value.some((r) => r.id === request.id)) return;
    queue.value = [...queue.value, request];
  }

  function remove(id: string) {
    queue.value = queue.value.filter((r) => r.id !== id);
  }

  const current = computed(() => queue.value[0] ?? null);

  return { queue, current, add, remove };
}
