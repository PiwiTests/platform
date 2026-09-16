// Config fields that are themselves credentials and must never be returned to
// clients: the webhook signing `secret`, the Slack incoming-webhook URL
// (`webhookUrl`) — anyone holding that URL can post to the channel — and any
// stored `token`/`apiKey`/`password`. The list and create endpoints only ever
// echo an email `address` or a webhook `url`, so dropping the secrets doesn't
// affect the dashboard. Global channels are visible to every user, so this
// stops a low-privilege user from reading another team's Slack URL.
export const SECRET_CONFIG_FIELDS = new Set(['webhookUrl', 'secret', 'token', 'apiKey', 'password']);

export function sanitizeChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (!SECRET_CONFIG_FIELDS.has(key)) safe[key] = value;
  }
  return safe;
}
