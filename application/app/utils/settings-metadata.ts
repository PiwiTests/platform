/**
 * Single source of truth for the Settings surface metadata: which pages exist,
 * their nav label/icon/route, the role required to access them, and the
 * overridable fields on each. Each field references a `HelpTopicKey` whose
 * `envVars` list the `PIWI_*` environment variable(s) that override it (env
 * always wins; the UI shows the field read-only when set).
 *
 * Location note: lives in `app/utils/` (not `shared/`) because it references
 * `HelpTopicKey` from `./help-content`, which is app-only. It is UI metadata
 * only — the server keeps being the actual resolver (`runtimeConfig` +
 * `resolveContextLimits` / `resolveWastedSettings` / `readAiSettings`).
 *
 * Consumed by: `useSettingsNav` (nav items + lock badges), `useSettingsEnvState`
 * (which pages are env-managed), and the settings pages themselves (page-level
 * env-var lists for banners + tooltips).
 */
import { Role } from '~~/shared/types';
import type { PiwiEnvVarName } from '~~/shared/piwi-env-vars';
import { helpEnvVars, type HelpTopicKey } from './help-content';

export type SettingsPageId = 'account' | 'users' | 'notifications' | 'tags' | 'storage' | 'wasted-time' | 'ai';

export interface SettingFieldMeta {
  /** Stable field id, e.g. `ai.diagnosis.provider`. */
  id: string;
  /** UI label (used by tooltips / lock affordances). */
  label: string;
  /** Help-registry topic key — carries the env-var list. */
  help: HelpTopicKey;
  /** True when the field is read-only-by-design (env-only, never editable). */
  envOnly?: boolean;
}

export interface SettingsPageMeta {
  id: SettingsPageId;
  label: string;
  icon: string;
  to: string;
  /** Roles that may access the page; omitted = any authenticated user. */
  roles?: Role[];
  /** Fields on this page (used to aggregate env vars + drive tooltips). */
  fields: SettingFieldMeta[];
  /** Topic key for a page-level intro hint shown under the nav. */
  introHelp?: HelpTopicKey;
}

export const SETTINGS_PAGES: SettingsPageMeta[] = [
  {
    id: 'account',
    label: 'Account',
    icon: 'i-lucide-user-round',
    to: '/settings/account',
    fields: [
      { id: 'account.display-name', label: 'Display name', help: 'account.display-name' },
      { id: 'account.email', label: 'Email address', help: 'account.email' },
      { id: 'account.connected-accounts', label: 'Connected accounts', help: 'account.connected-accounts' },
      { id: 'account.password', label: 'Password', help: 'account.password' },
      { id: 'account.auth-toggle', label: 'Authentication', help: 'settings.auth-toggle', envOnly: true },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    icon: 'i-lucide-users',
    to: '/settings/users',
    roles: [Role.ADMINISTRATOR],
    introHelp: 'settings.users',
    fields: [
      { id: 'users.list', label: 'Users & roles', help: 'settings.users' },
      { id: 'users.api-keys', label: 'API keys', help: 'settings.api-keys' },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'i-lucide-bell',
    to: '/settings/notifications',
    fields: [
      { id: 'notifications.smtp', label: 'SMTP email delivery', help: 'settings.smtp', envOnly: true },
      { id: 'notifications.test-email', label: 'Send test email', help: 'notifications.test-email' },
      { id: 'notifications.channels', label: 'Notification channels', help: 'notifications.channels' },
      { id: 'notifications.subscriptions', label: 'My subscriptions', help: 'notifications.subscriptions' },
    ],
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: 'i-lucide-tags',
    to: '/settings/tags',
    roles: [Role.ADMINISTRATOR],
    introHelp: 'settings.tags',
    fields: [{ id: 'tags.list', label: 'Tags', help: 'settings.tags' }],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: 'i-lucide-hard-drive',
    to: '/settings/storage',
    roles: [Role.ADMINISTRATOR],
    fields: [
      { id: 'storage.backend', label: 'Storage backend', help: 'settings.storage-backend', envOnly: true },
      { id: 'storage.stats', label: 'Storage statistics', help: 'settings.storage-stats' },
      { id: 'storage.cleanup', label: 'Cleanup old test runs', help: 'settings.cleanup' },
    ],
  },
  {
    id: 'wasted-time',
    label: 'Wasted time',
    icon: 'i-lucide-hourglass',
    to: '/settings/wasted-time',
    roles: [Role.ADMINISTRATOR],
    introHelp: 'settings.wasted-time',
    fields: [{ id: 'wasted-time.patterns', label: 'Wasted-time patterns', help: 'settings.wasted-time' }],
  },
  {
    id: 'ai',
    label: 'AI diagnosis',
    icon: 'i-lucide-sparkles',
    to: '/settings/ai',
    roles: [Role.ADMINISTRATOR],
    fields: [
      { id: 'ai.diagnosis', label: 'Diagnosis model', help: 'settings.ai-provider' },
      { id: 'ai.research', label: 'Research model', help: 'settings.ai-research' },
      { id: 'ai.embedding', label: 'Embedding model', help: 'settings.embedding-model' },
      { id: 'ai.auto-diagnose', label: 'Auto-diagnose', help: 'settings.auto-diagnose' },
      { id: 'ai.context-limits', label: 'Diagnosis context limits', help: 'settings.ai-limits' },
      { id: 'ai.instructions', label: 'Global analysis instructions', help: 'settings.ai-instructions' },
      { id: 'ai.scm-token', label: 'Repository access token', help: 'project.scm-token' },
      { id: 'ai.privacy', label: 'Privacy notice', help: 'settings.privacy' },
    ],
  },
];

// ── Env-var helpers ────────────────────────────────────────────────────────

/** Env var(s) backing a field, resolved from its help topic. */
export function fieldEnvVars(field: SettingFieldMeta): PiwiEnvVarName[] {
  return helpEnvVars(field.help);
}

/** Whether a field can be overridden by an env var. */
export function fieldIsOverridable(field: SettingFieldMeta): boolean {
  return fieldEnvVars(field).length > 0;
}

/** Union of all env vars across a page's fields (for banners / nav badges). */
export function pageEnvVars(page: SettingsPageMeta): PiwiEnvVarName[] {
  const seen = new Set<PiwiEnvVarName>();
  for (const f of page.fields) for (const v of fieldEnvVars(f)) seen.add(v);
  return [...seen];
}

/** A page is "env-overridable" if any of its fields can be pinned by env. */
export function pageIsOverridable(page: SettingsPageMeta): boolean {
  return page.fields.some(fieldIsOverridable);
}

/** Look up a page by id. */
export function getSettingsPage(id: SettingsPageId): SettingsPageMeta {
  const page = SETTINGS_PAGES.find((p) => p.id === id);
  if (!page) throw new Error(`Unknown settings page: ${id}`);
  return page;
}
