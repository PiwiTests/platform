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
 * SMTP is always env-only (read-only display); the Performance page when its
 * wasted-wait patterns come from env. Pages with no env-overridable fields
 * (account, users, tags) are never env-managed. Storage backend is env-only by
 * design but no endpoint
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
    performance: false,
    'pr-feedback': false,
    'auto-heal': false,
    integrations: false,
    ai: false,
    about: false,
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
          // Performance groups wasted-time + timeout-hygiene; wasted-wait patterns
          // are the only env-pinnable field, so they drive the page's lock badge.
          envManaged.value.performance = Boolean(s.envManaged);
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

    tasks.push(
      $fetch<{ connections: { managedBy: string }[] }>('/api/integrations/connections')
        .then((s) => {
          // Integrations is env-managed when a connection comes from the environment.
          envManaged.value.integrations = (s.connections ?? []).some((c) => c.managedBy === 'env');
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
