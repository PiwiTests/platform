import type { SettingsPageId } from '~/utils/settings-metadata';
import type { AiSettings } from '~~/types/api';

interface SmtpStatus {
  configured: boolean;
  envManaged: boolean;
}

interface WastedSettings {
  envManaged: boolean;
}

/**
 * Resolves which settings pages are currently "env-managed" (one or more of
 * their fields pinned by a `PIWI_*` env var), so the settings nav can show a
 * lock badge and pages can show the standardized banner.
 *
 * Reuses the existing `GET /api/settings/*` endpoints — no new server API. The
 * AI page is env-managed when its provider is env-pinned (`AiSettings.envManaged`);
 * SMTP is always env-only (read-only display); wasted-time when its patterns
 * come from env. Pages with no env-overridable fields (account, users, tags) are
 * never env-managed. Storage backend is env-only by design but no endpoint
 * reports it today, so it is treated as "overridable but not necessarily locked"
 * (the page shows the env-var reference card regardless).
 *
 * Fetches lazily and only on the client (these endpoints are admin-gated; in
 * demo mode they are served by the service worker).
 */
export function useSettingsEnvState() {
  const envManaged = ref<Record<SettingsPageId, boolean>>({
    account: false,
    users: false,
    notifications: false,
    tags: false,
    storage: false,
    'wasted-time': false,
    ai: false,
  });

  async function refresh() {
    // Non-admin / unauthenticated users can't read these; default to false.
    const tasks: Promise<void>[] = [];

    tasks.push(
      $fetch<AiSettings>('/api/settings/ai')
        .then((s) => {
          envManaged.value.ai = Boolean(s.envManaged);
        })
        .catch(() => {}),
    );

    tasks.push(
      $fetch<WastedSettings>('/api/settings/wasted-waits')
        .then((s) => {
          envManaged.value['wasted-time'] = Boolean(s.envManaged);
        })
        .catch(() => {}),
    );

    tasks.push(
      $fetch<SmtpStatus>('/api/settings/smtp')
        .then((s) => {
          // SMTP is env-only by design; mark managed when configured.
          envManaged.value.notifications = Boolean(s.envManaged && s.configured);
        })
        .catch(() => {}),
    );

    await Promise.all(tasks);
  }

  // Fetch once on mount (client-only to avoid auth-gated SSR calls).
  if (import.meta.client) {
    onMounted(() => {
      void refresh();
    });
  }

  return { envManaged, refresh };
}
