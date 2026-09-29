/** The demo's one notification channel: the visitor's account email, never sent to. */
export const DEMO_CHANNEL = {
  id: 1,
  name: 'Account email',
  type: 'personal_email',
  userId: null as number | null,
  verified: true,
  config: { address: 'demo@example.com' },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
