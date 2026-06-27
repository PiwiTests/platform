/**
 * Single source of truth for every `PIWI_*` environment variable the
 * application understands. Each entry pairs the variable name (the object key,
 * so it is a compile-time-checked literal) with a short human description and a
 * functional category.
 *
 * Consumed by:
 * - `app/utils/help-content.ts` — `HelpTopic.envVars` is typed as
 *   `PiwiEnvVarName[]`, so a help tooltip can never reference an env var that
 *   does not exist here.
 * - `app/utils/settings-metadata.ts` — settings fields reference env vars by
 *   typed name.
 * - `app/components/shared/EnvManagedBadge.vue` / `EnvManagedAlert.vue` —
 *   tooltips/banners render the name + description.
 * - server utils may read descriptions for logging/validation.
 *
 * The canonical user-facing reference table is `docs/configuration.md`; this
 * registry is what keeps the in-app tooltips and that table saying the same
 * thing. When you add a new `PIWI_*` var to `nuxt.config.ts` or a server util,
 * add it here in the same change.
 *
 * Note: the reporter package (`reporter/src/config.ts`) has its own
 * `PIWI_ENV_KEYS` map for the vars it reads in CI — those overlap with the
 * ingestion vars here but are owned by the reporter, not this registry.
 */

export type PiwiEnvVarCategory =
  | 'general'
  | 'database'
  | 'storage'
  | 'auth'
  | 'oauth'
  | 'ai'
  | 'ai-limits'
  | 'clustering'
  | 'smtp'
  | 'wasted-time'
  | 'demo'
  | 'build'
  | 'test';

export interface PiwiEnvVarMeta {
  /** Short human description of what the variable controls. */
  description: string;
  /** Functional grouping used for filtering/docs anchors. */
  category: PiwiEnvVarCategory;
  /** Whether the value is a secret (API key / password). Never logged or returned by the API. */
  secret?: boolean;
  /** True for build/test-harness-only vars that are not runtime settings. */
  runtimeOnly?: boolean;
}

export const PIWI_ENV_VARS = {
  // ── General ──────────────────────────────────────────────────────────────
  PIWI_SITE_URL: {
    description: 'Public base URL of the instance (e.g. https://piwi.example.com). Used to build links in emails.',
    category: 'general',
  },
  PIWI_SECRET_KEY: {
    description:
      'Master key for AES-256-GCM encryption of secrets stored in the database (AI API keys, webhook/SCM secrets). Strongly recommended in production.',
    category: 'general',
    secret: true,
  },
  PIWI_BUILD_DIR: {
    description: 'Overrides the Nuxt build output directory. Used by the test harness to isolate parallel builds.',
    category: 'build',
    runtimeOnly: true,
  },

  // ── Database ─────────────────────────────────────────────────────────────
  PIWI_DATABASE_PATH: {
    description: 'Path to the SQLite database file (used when PIWI_DATABASE_URL is not set).',
    category: 'database',
  },
  PIWI_DATABASE_URL: {
    description:
      'PostgreSQL connection string. When set, PostgreSQL is used instead of SQLite and migrations run automatically on startup.',
    category: 'database',
    secret: true,
  },

  // ── Storage ──────────────────────────────────────────────────────────────
  PIWI_STORAGE_TYPE: {
    description: 'Storage backend for test artifacts (HTML reports, traces, attachments): "local" or "s3".',
    category: 'storage',
  },
  PIWI_STORAGE_PATH: {
    description: 'Directory for local file storage (when PIWI_STORAGE_TYPE is "local").',
    category: 'storage',
  },
  PIWI_S3_BUCKET: {
    description: 'S3 bucket name for artifact storage (when PIWI_STORAGE_TYPE is "s3").',
    category: 'storage',
  },
  PIWI_S3_REGION: {
    description: 'S3 bucket region (when PIWI_STORAGE_TYPE is "s3").',
    category: 'storage',
  },
  PIWI_S3_ACCESS_KEY_ID: {
    description: 'S3 access key id with write access to the bucket.',
    category: 'storage',
    secret: true,
  },
  PIWI_S3_SECRET_ACCESS_KEY: {
    description: 'S3 secret access key.',
    category: 'storage',
    secret: true,
  },
  PIWI_S3_ENDPOINT: {
    description: 'Custom endpoint for S3-compatible services (MinIO, R2, Spaces).',
    category: 'storage',
  },
  PIWI_S3_FORCE_PATH_STYLE: {
    description: 'Use path-style addressing (required by some S3-compatible services).',
    category: 'storage',
  },

  // ── Authentication ───────────────────────────────────────────────────────
  PIWI_AUTH_ENABLED: {
    description: 'Set to "true" to enable role-based access control and API keys. Off by default.',
    category: 'auth',
  },
  PIWI_AUTH_SECRET: {
    description: 'Secret used to sign/encrypt session cookies. Required when PIWI_AUTH_ENABLED is true.',
    category: 'auth',
    secret: true,
  },

  // ── OAuth ────────────────────────────────────────────────────────────────
  PIWI_OAUTH_GOOGLE_CLIENT_ID: {
    description: 'Google OAuth client id (optional single sign-on).',
    category: 'oauth',
  },
  PIWI_OAUTH_GOOGLE_CLIENT_SECRET: {
    description: 'Google OAuth client secret.',
    category: 'oauth',
    secret: true,
  },
  PIWI_OAUTH_GITHUB_CLIENT_ID: {
    description: 'GitHub OAuth client id (optional single sign-on).',
    category: 'oauth',
  },
  PIWI_OAUTH_GITHUB_CLIENT_SECRET: {
    description: 'GitHub OAuth client secret.',
    category: 'oauth',
    secret: true,
  },
  PIWI_OAUTH_ALLOWED_DOMAINS: {
    description: 'Comma-separated verified email domains allowed to sign in via OAuth (all providers).',
    category: 'oauth',
  },
  PIWI_OAUTH_GITHUB_ALLOWED_ORGS: {
    description: 'Comma-separated GitHub org logins a user must belong to (requests read:org scope).',
    category: 'oauth',
  },

  // ── AI — diagnosis model ─────────────────────────────────────────────────
  PIWI_AI_PROVIDER: {
    description: 'AI provider for failure diagnosis: "anthropic" or "openai" (OpenAI-compatible).',
    category: 'ai',
  },
  PIWI_AI_API_KEY: {
    description: 'API key for the diagnosis provider. Takes precedence over the DB-stored key.',
    category: 'ai',
    secret: true,
  },
  PIWI_AI_MODEL: {
    description: 'Diagnosis model name (default: claude-opus-4-8 for Anthropic).',
    category: 'ai',
  },
  PIWI_AI_BASE_URL: {
    description: 'Base URL for OpenAI-compatible providers (e.g. http://localhost:11434/v1).',
    category: 'ai',
  },
  PIWI_AI_AUTO_DIAGNOSE: {
    description: 'Set to "true" to auto-diagnose new failure clusters when a run finishes.',
    category: 'ai',
  },

  // ── AI — research model ──────────────────────────────────────────────────
  PIWI_AI_RESEARCH_PROVIDER: {
    description: 'Provider for the optional research (pre-analysis) stage. Falls back to PIWI_AI_PROVIDER.',
    category: 'ai',
  },
  PIWI_AI_RESEARCH_MODEL: {
    description: 'Cheaper/faster model for the research stage. Empty disables the two-stage pipeline.',
    category: 'ai',
  },
  PIWI_AI_RESEARCH_BASE_URL: {
    description: 'Base URL for the research-stage provider. Falls back to PIWI_AI_BASE_URL.',
    category: 'ai',
  },
  PIWI_AI_RESEARCH_API_KEY: {
    description: 'API key for the research-stage provider. Falls back to PIWI_AI_API_KEY.',
    category: 'ai',
    secret: true,
  },

  // ── AI — embedding model ─────────────────────────────────────────────────
  PIWI_AI_EMBEDDING_PROVIDER: {
    description: 'Provider for embeddings (semantic failure clustering). Falls back to PIWI_AI_PROVIDER.',
    category: 'ai',
  },
  PIWI_AI_EMBEDDING_MODEL: {
    description: 'Embedding model name (e.g. text-embedding-3-small).',
    category: 'ai',
  },
  PIWI_AI_EMBEDDING_BASE_URL: {
    description: 'Base URL for the embedding provider. Falls back to PIWI_AI_BASE_URL.',
    category: 'ai',
  },
  PIWI_AI_EMBEDDING_API_KEY: {
    description: 'API key for the embedding provider. Falls back to PIWI_AI_API_KEY.',
    category: 'ai',
    secret: true,
  },

  // ── AI — diagnosis context limits ────────────────────────────────────────
  PIWI_AI_MAX_SAMPLE_ERROR_CHARS: {
    description: 'Max characters of raw error text (per error block).',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_SCM_PATCH_BUDGET: {
    description: 'Total characters of diff patches across changed files.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_AFFECTED_TESTS: {
    description: 'Max affected tests listed in the diagnosis context.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_STEPS: {
    description: 'Max recent test steps included.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_CONSOLE_ENTRIES: {
    description: 'Max console error/warning entries included.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_CONSOLE_ENTRY_CHARS: {
    description: 'Max characters per console entry.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_NETWORK_REQUESTS: {
    description: 'Max failed network requests included.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS: {
    description: 'Max characters of the page ARIA snapshot.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_TEST_SOURCE_CHARS: {
    description: 'Max characters of the test source snippet.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_SERVER_LOG_ENTRIES: {
    description: 'Max backend server log entries (from X-Piwi-Logs header) included.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_SERVER_LOG_ENTRY_CHARS: {
    description: 'Max characters per backend server log entry.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_IMAGES: {
    description: 'Max screenshots auto-included in the diagnosis context.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_PASSED_PEERS: {
    description: 'Max peer tests in the same file listed when they passed.',
    category: 'ai-limits',
  },
  PIWI_AI_MAX_CONSOLE_WINDOW: {
    description: 'Max console entries of any type in the window before failure.',
    category: 'ai-limits',
  },
  PIWI_AI_SLOW_REQUEST_MS: {
    description: 'Network request duration (ms) threshold for flagging as slow.',
    category: 'ai-limits',
  },

  // ── Failure clustering ───────────────────────────────────────────────────
  PIWI_CLUSTER_SIMILARITY_THRESHOLD: {
    description: 'Cosine similarity (0–1) above which two failure embeddings merge into one cluster.',
    category: 'clustering',
  },
  PIWI_CLUSTER_SUGGEST_THRESHOLD: {
    description: 'Similarity at which a failure is suggested (not auto-merged) as related to a cluster.',
    category: 'clustering',
  },

  // ── SMTP ─────────────────────────────────────────────────────────────────
  PIWI_SMTP_HOST: {
    description: 'SMTP server hostname for outbound email.',
    category: 'smtp',
  },
  PIWI_SMTP_PORT: {
    description: 'SMTP port (default 587; 465 for implicit TLS).',
    category: 'smtp',
  },
  PIWI_SMTP_USER: {
    description: 'SMTP username.',
    category: 'smtp',
  },
  PIWI_SMTP_PASS: {
    description: 'SMTP password. Never returned by the API.',
    category: 'smtp',
    secret: true,
  },
  PIWI_SMTP_FROM: {
    description: 'From address for outbound email (e.g. noreply@example.com).',
    category: 'smtp',
  },
  PIWI_SMTP_FROM_NAME: {
    description: 'Display name for the from address (optional).',
    category: 'smtp',
  },
  PIWI_SMTP_SECURE: {
    description: 'Set to "true" for implicit TLS on port 465 (default false → STARTTLS/plain).',
    category: 'smtp',
  },

  // ── Wasted-time analysis ─────────────────────────────────────────────────
  PIWI_WASTED_WAIT_PATTERNS: {
    description:
      'Glob patterns (comma or newline separated) defining which wait steps count as wasted time. Locks the UI when set.',
    category: 'wasted-time',
  },

  // ── Demo / build mode ────────────────────────────────────────────────────
  PIWI_DEMO_MODE: {
    description: 'Set to "true" to build the standalone client-side demo SPA (no server).',
    category: 'demo',
    runtimeOnly: true,
  },

  // ── Test harness only (not user settings) ────────────────────────────────
  PIWI_BASE_URL: {
    description: 'Base URL the metadata test spec targets (defaults to http://localhost:3000).',
    category: 'test',
    runtimeOnly: true,
  },
  PIWI_POSTGRES_TEST_URL: {
    description: 'PostgreSQL connection string used by the Postgres test suite.',
    category: 'test',
    runtimeOnly: true,
    secret: true,
  },
  PIWI_S3_TEST_BUCKET: {
    description: 'S3 bucket for the storage integration tests.',
    category: 'test',
    runtimeOnly: true,
  },
  PIWI_S3_TEST_REGION: {
    description: 'Region for the S3 storage integration tests.',
    category: 'test',
    runtimeOnly: true,
  },
  PIWI_S3_TEST_ACCESS_KEY_ID: {
    description: 'Access key id for the S3 storage integration tests.',
    category: 'test',
    runtimeOnly: true,
    secret: true,
  },
  PIWI_S3_TEST_SECRET_ACCESS_KEY: {
    description: 'Secret access key for the S3 storage integration tests.',
    category: 'test',
    runtimeOnly: true,
    secret: true,
  },
  PIWI_S3_TEST_ENDPOINT: {
    description: 'Custom endpoint for the S3 storage integration tests.',
    category: 'test',
    runtimeOnly: true,
  },
  PIWI_MAILPIT_URL: {
    description: 'Mailpit base URL; when set, the email/notification E2E tests run against it.',
    category: 'test',
    runtimeOnly: true,
  },
  PIWI_MAILPIT_SMTP_PORT: {
    description: 'SMTP port the email E2E tests send to (Mailpit).',
    category: 'test',
    runtimeOnly: true,
  },
  PIWI_EMAIL_SERVER_URL: {
    description: 'Base URL the email test spec targets.',
    category: 'test',
    runtimeOnly: true,
  },
} as const satisfies Record<string, PiwiEnvVarMeta>;

/** Typed union of every `PIWI_*` env var name. */
export type PiwiEnvVarName = keyof typeof PIWI_ENV_VARS;

/** Metadata for a single env var. */
export function getEnvVarMeta(name: PiwiEnvVarName): PiwiEnvVarMeta {
  return PIWI_ENV_VARS[name];
}

/** All env var names in a given category. */
export function envVarsByCategory(category: PiwiEnvVarCategory): PiwiEnvVarName[] {
  return (Object.keys(PIWI_ENV_VARS) as PiwiEnvVarName[]).filter((name) => PIWI_ENV_VARS[name].category === category);
}

/** Whether a var is a real runtime setting (excludes build/test-harness vars). */
export function isRuntimeSetting(name: PiwiEnvVarName): boolean {
  return !getEnvVarMeta(name).runtimeOnly;
}
