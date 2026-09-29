/**
 * Deletes a project and follows the deletion while it runs.
 *
 * The DELETE request answers only once everything is gone, which takes minutes
 * on a project with a long history, so meanwhile the composable polls
 * `/api/projects/:id/deletion` for the phase and the run count, and keeps an
 * elapsed-time clock. `progress` stays null until the server reports a phase,
 * and for the whole deletion on a server that reports none (the demo).
 */

import type { ApiResponse } from '~~/types/api';

type DeletionResponse = ApiResponse<typeof import('~~/server/api/projects/[id]/deletion.get').default>;

const POLL_INTERVAL_MS = 1000;

export function useProjectDeletion(projectId: number | string) {
  const deleting = ref(false);
  const progress = ref<DeletionResponse['progress']>(null);
  const elapsedMs = ref(0);

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  function stopTimers() {
    clearTimeout(pollTimer);
    clearInterval(clockTimer);
  }

  async function poll() {
    try {
      const res = await $fetch<DeletionResponse>(`/api/projects/${projectId}/deletion`);
      if (deleting.value && res.progress) progress.value = res.progress;
    } catch {
      // A missed poll keeps the last known progress on screen.
    }
    if (deleting.value) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  /**
   * Resolves once the project is deleted, leaving `deleting` set for the
   * caller's navigation away. Rethrows the request's error with `deleting` reset.
   */
  async function deleteProject(): Promise<void> {
    if (deleting.value) return;
    deleting.value = true;
    progress.value = null;
    elapsedMs.value = 0;
    const startedAt = Date.now();
    clockTimer = setInterval(() => (elapsedMs.value = Date.now() - startedAt), 1000);
    pollTimer = setTimeout(poll, 300);
    try {
      await $fetch(`/api/projects/${projectId}` as '/api/projects/:id', { method: 'DELETE' });
    } catch (error) {
      deleting.value = false;
      throw error;
    } finally {
      stopTimers();
    }
  }

  onScopeDispose(stopTimers);

  return { deleting, progress, elapsedMs, deleteProject };
}
