/**
 * Pure metadata for every integration provider. The settings UI, the connect
 * form and the docs render from this registry; the server-side client code lives
 * in `server/utils/integrations/`. Keep this file free of runtime dependencies —
 * it loads unchanged in the app, the demo and plain Node.
 */

/** Whether a provider files tickets (tracker) or publishes pages (wiki). */
export type IntegrationKind = 'tracker' | 'wiki';

/** A field the connect form collects into the connection's credential blob. */
export interface CredentialField {
  /** Key inside the encrypted credentials JSON. */
  key: string;
  label: string;
  type: 'text' | 'password';
  /** Redacted on read and never returned by any endpoint. */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export interface IntegrationProviderMeta {
  kind: IntegrationKind;
  label: string;
  /** Icon name for the provider (Nuxt UI icon syntax). */
  icon: string;
  /** What the provider's client can do; the UI and later milestones read these. */
  capabilities: readonly string[];
  /** The credential inputs the connect form generates, beyond name and base URL. */
  credentialFields: readonly CredentialField[];
  /** Docs anchor (`page#hash`) describing how to connect this provider. */
  docsAnchor: string;
}

export const INTEGRATION_PROVIDERS = {
  jira: {
    kind: 'tracker',
    label: 'Jira',
    icon: 'i-simple-icons-jira',
    capabilities: ['create', 'comment', 'transition', 'search', 'attach', 'assignable-users', 'webhook'],
    credentialFields: [
      {
        key: 'email',
        label: 'Account email',
        type: 'text',
        required: true,
        placeholder: 'you@example.com',
        help: 'The Atlassian account the API token belongs to.',
      },
      {
        key: 'apiToken',
        label: 'API token',
        type: 'password',
        secret: true,
        required: true,
        help: 'Create one at id.atlassian.com under Security → API tokens.',
      },
    ],
    docsAnchor: 'operate/integrations#connecting-jira-cloud',
  },
} as const satisfies Record<string, IntegrationProviderMeta>;

export type IntegrationProviderName = keyof typeof INTEGRATION_PROVIDERS;

/** The providers as an ordered list for rendering one card each. */
export const INTEGRATION_PROVIDER_LIST = Object.entries(INTEGRATION_PROVIDERS).map(([name, meta]) => ({
  name: name as IntegrationProviderName,
  ...meta,
}));

export function isIntegrationProvider(value: string): value is IntegrationProviderName {
  return Object.prototype.hasOwnProperty.call(INTEGRATION_PROVIDERS, value);
}
