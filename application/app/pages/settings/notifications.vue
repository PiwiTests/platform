<script setup lang="ts">
import { NOTIFICATION_EVENTS } from '#shared/notification-events';
import type { NotificationEvent } from '#shared/notification-events';

const toast = useToast();
const config = useRuntimeConfig();
const authEnabled = computed(() => config.public.authEnabled);

// ── SMTP status ────────────────────────────────────────────────────────────────
interface SmtpStatus {
  host: string | null;
  port: number;
  user: string | null;
  from: string | null;
  fromName: string | null;
  hasPassword: boolean;
  secure: boolean;
  configured: boolean;
  envManaged: boolean;
}

const { data: smtp } = await useFetch<SmtpStatus>('/api/settings/smtp');
const testEmailTo = ref('');
const testingSmtp = ref(false);

async function sendTestEmail() {
  if (!testEmailTo.value) return;
  testingSmtp.value = true;
  try {
    const res = await $fetch<{ success: boolean; error?: string }>('/api/settings/smtp/test', {
      method: 'POST',
      body: { to: testEmailTo.value },
    });
    if (res.success) {
      toast.add({ title: 'Test email sent', description: `Check ${testEmailTo.value}`, color: 'success' });
    } else {
      toast.add({ title: 'Send failed', description: res.error || 'Unknown error', color: 'error' });
    }
  } catch (e) {
    toast.add({ title: 'Send failed', description: String((e as Error)?.message ?? e), color: 'error' });
  } finally {
    testingSmtp.value = false;
  }
}

// ── Channels ──────────────────────────────────────────────────────────────────
interface Channel {
  id: number;
  name: string;
  type: string;
  userId: number | null;
  verified: boolean;
  config: Record<string, unknown>;
}

const { data: channelsData, refresh: refreshChannels } = authEnabled.value
  ? await useFetch<{ channels: Channel[] }>('/api/channels')
  : { data: ref(null), refresh: () => {} };

const channels = computed(() => channelsData.value?.channels ?? []);

// New channel form
const showNewChannel = ref(false);
const newChannel = reactive({
  name: '',
  type: 'email' as 'email' | 'slack' | 'webhook',
  address: '',
  webhookUrl: '',
  url: '',
  secret: '',
  global: false,
});
const savingChannel = ref(false);
const testingChannel = ref<number | null>(null);

const channelTypeOptions = [
  { label: 'Email', value: 'email' },
  { label: 'Slack webhook', value: 'slack' },
  { label: 'Webhook', value: 'webhook' },
];

async function saveChannel() {
  savingChannel.value = true;
  try {
    const config: Record<string, unknown> = {};
    if (newChannel.type === 'email') config.address = newChannel.address;
    else if (newChannel.type === 'slack') config.webhookUrl = newChannel.webhookUrl;
    else if (newChannel.type === 'webhook') {
      config.url = newChannel.url;
      if (newChannel.secret) config.secret = newChannel.secret;
    }
    await $fetch('/api/channels', {
      method: 'POST',
      body: { name: newChannel.name, type: newChannel.type, config, global: newChannel.global },
    });
    showNewChannel.value = false;
    Object.assign(newChannel, {
      name: '',
      type: 'email',
      address: '',
      webhookUrl: '',
      url: '',
      secret: '',
      global: false,
    });
    await refreshChannels();
    toast.add({ title: 'Channel created', color: 'success' });
  } catch (e) {
    toast.add({ title: 'Failed to create channel', description: String((e as Error)?.message ?? e), color: 'error' });
  } finally {
    savingChannel.value = false;
  }
}

async function deleteChannel(id: number) {
  try {
    await $fetch(`/api/channels/${id}`, { method: 'DELETE' });
    await refreshChannels();
    toast.add({ title: 'Channel deleted', color: 'success' });
  } catch (e) {
    toast.add({ title: 'Failed to delete channel', description: String((e as Error)?.message ?? e), color: 'error' });
  }
}

async function testChannel(id: number) {
  testingChannel.value = id;
  try {
    const res = await $fetch<{ success: boolean; error?: string }>(`/api/channels/${id}/test`, { method: 'POST' });
    if (res.success) toast.add({ title: 'Test notification sent', color: 'success' });
    else toast.add({ title: 'Test failed', description: res.error, color: 'error' });
  } catch (e) {
    toast.add({ title: 'Test failed', description: String((e as Error)?.message ?? e), color: 'error' });
  } finally {
    testingChannel.value = null;
  }
}

// ── Subscriptions ─────────────────────────────────────────────────────────────
interface Subscription {
  id: number;
  userId: number | null;
  projectId: number | null;
  events: string[] | null;
  filters: Record<string, unknown> | null;
  mode: string;
  digestAt: string | null;
  mutedUntil: string | null;
  active: boolean;
  channel: { id: number; name: string; type: string };
}

const { data: subsData, refresh: refreshSubs } = authEnabled.value
  ? await useFetch<{ subscriptions: Subscription[] }>('/api/subscriptions')
  : { data: ref(null), refresh: () => {} };

const subs = computed(() => subsData.value?.subscriptions ?? []);

async function deleteSub(id: number) {
  try {
    await $fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
    await refreshSubs();
    toast.add({ title: 'Subscription removed', color: 'success' });
  } catch (e) {
    toast.add({
      title: 'Failed to remove subscription',
      description: String((e as Error)?.message ?? e),
      color: 'error',
    });
  }
}

async function toggleMute(sub: Subscription) {
  const isMuted = sub.mutedUntil && new Date(sub.mutedUntil) > new Date();
  try {
    await $fetch(`/api/subscriptions/${sub.id}`, {
      method: 'PATCH',
      body: { mutedUntil: isMuted ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
    });
    await refreshSubs();
    toast.add({ title: isMuted ? 'Unmuted' : 'Muted for 7 days', color: 'success' });
  } catch (e) {
    toast.add({
      title: 'Failed to update subscription',
      description: String((e as Error)?.message ?? e),
      color: 'error',
    });
  }
}

function isMuted(sub: Subscription) {
  return sub.mutedUntil && new Date(sub.mutedUntil) > new Date();
}

function channelTypeIcon(type: string) {
  if (type === 'personal_email') return 'i-lucide-user-round';
  if (type === 'email') return 'i-lucide-mail';
  if (type === 'slack') return 'i-lucide-slack';
  return 'i-lucide-webhook';
}

function eventLabel(e: string) {
  return e.replace(/\./g, ' › ');
}
</script>

<template>
  <div class="space-y-6">
    <!-- SMTP status (read-only, admin only) -->
    <SectionCard icon="i-lucide-mail" title="SMTP email delivery" help="settings.smtp">
      <template #subtitle> Configure SMTP via environment variables. The connection cannot be changed here. </template>

      <div class="space-y-3">
        <div v-if="smtp?.configured" class="flex items-center gap-2 text-sm text-success-600 dark:text-success-400">
          <UIcon name="i-lucide-circle-check-big" class="size-4" />
          Configured
        </div>
        <div v-else class="flex items-center gap-2 text-sm text-warning-600 dark:text-warning-400">
          <UIcon name="i-lucide-circle-alert" class="size-4" />
          Not configured
        </div>

        <div v-if="smtp?.configured" class="grid grid-cols-2 gap-2 text-sm">
          <div class="text-muted">Host</div>
          <div class="font-mono">{{ smtp?.host }}:{{ smtp?.port }}</div>
          <div class="text-muted">From</div>
          <div>{{ smtp?.fromName ? `${smtp.fromName} <${smtp.from}>` : smtp?.from }}</div>
          <div class="text-muted">User</div>
          <div class="font-mono">{{ smtp?.user }}</div>
          <div class="text-muted">TLS</div>
          <div>{{ smtp?.secure ? 'Yes (port 465)' : 'STARTTLS / plain' }}</div>
        </div>

        <div v-if="!smtp?.configured" class="text-sm text-muted space-y-1">
          <p>Set these environment variables to enable email notifications:</p>
          <CodeBlock
            code="PIWI_SMTP_HOST=smtp.example.com
PIWI_SMTP_PORT=465
PIWI_SMTP_USER=user@example.com
PIWI_SMTP_PASS=secret
PIWI_SMTP_FROM=noreply@example.com
PIWI_SMTP_FROM_NAME=Piwi Dashboard"
            lang="bash"
          />
        </div>
      </div>

      <template v-if="smtp?.configured" #footer>
        <div class="flex items-center gap-2">
          <UInput v-model="testEmailTo" type="email" placeholder="Send test to email address…" class="flex-1" />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-send"
            :loading="testingSmtp"
            :disabled="!testEmailTo"
            @click="sendTestEmail"
          >
            Send test
          </UButton>
        </div>
      </template>
    </SectionCard>

    <!-- Channels (gated on auth) -->
    <template v-if="authEnabled">
      <SectionCard icon="i-lucide-radio" title="Notification channels" :count="channels.length" help="notifications.channels">
        <template #actions>
          <UButton size="sm" icon="i-lucide-plus" @click="showNewChannel = !showNewChannel"> Add channel </UButton>
        </template>

        <!-- New channel form -->
        <div v-if="showNewChannel" class="mb-4 p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
          <h4 class="font-medium text-sm">New channel</h4>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Name">
              <UInput v-model="newChannel.name" placeholder="e.g. My email" class="w-full" />
            </UFormField>
            <UFormField label="Type">
              <USelect v-model="newChannel.type" :items="channelTypeOptions" class="w-full" />
            </UFormField>
          </div>

          <UFormField v-if="newChannel.type === 'email'" label="Email address">
            <UInput v-model="newChannel.address" type="email" placeholder="you@example.com" class="w-full" />
          </UFormField>
          <UFormField v-else-if="newChannel.type === 'slack'" label="Slack webhook URL">
            <UInput v-model="newChannel.webhookUrl" placeholder="https://hooks.slack.com/…" class="w-full" />
          </UFormField>
          <template v-else-if="newChannel.type === 'webhook'">
            <UFormField label="Endpoint URL">
              <UInput v-model="newChannel.url" placeholder="https://your-server.com/webhook" class="w-full" />
            </UFormField>
            <UFormField label="Secret (optional)" description="Used to sign requests with X-Piwi-Signature header">
              <UInput v-model="newChannel.secret" type="password" placeholder="Shared secret" class="w-full" />
            </UFormField>
          </template>

          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="sm" @click="showNewChannel = false">Cancel</UButton>
            <UButton
              color="primary"
              size="sm"
              :loading="savingChannel"
              :disabled="!newChannel.name"
              @click="saveChannel"
            >
              Save channel
            </UButton>
          </div>
        </div>

        <div v-if="channels.length === 0 && !showNewChannel" class="text-sm text-muted py-4 text-center">
          No channels yet. Add one to start receiving notifications.
        </div>

        <div class="space-y-2">
          <div
            v-for="ch in channels"
            :key="ch.id"
            class="flex items-center gap-3 rounded-lg border border-default px-4 py-3"
          >
            <UIcon :name="channelTypeIcon(ch.type)" class="size-5 text-muted shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm flex items-center gap-1.5">
                {{ ch.name }}
                <UBadge v-if="ch.type === 'personal_email'" size="xs" variant="soft" color="neutral">auto</UBadge>
              </div>
              <div class="text-xs text-muted">
                <template v-if="ch.type === 'personal_email' || ch.type === 'email'">{{
                  ch.config.address as string
                }}</template>
                <template v-else-if="ch.type === 'slack'">Slack webhook</template>
                <template v-else>{{ ch.config.url as string }}</template>
                <span v-if="ch.userId === null" class="ml-1 text-primary text-xs">(global)</span>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <UButton
                icon="i-lucide-send"
                color="neutral"
                variant="ghost"
                size="sm"
                title="Send test notification"
                :loading="testingChannel === ch.id"
                @click="testChannel(ch.id)"
              />
              <UTooltip v-if="ch.type === 'personal_email'" text="Remove your email in Account settings to disconnect">
                <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" disabled />
              </UTooltip>
              <UButton
                v-else
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                title="Delete channel"
                @click="deleteChannel(ch.id)"
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Subscriptions -->
      <SectionCard icon="i-lucide-bell" title="My subscriptions" :count="subs.length" help="notifications.subscriptions">
        <div v-if="subs.length === 0" class="text-sm text-muted py-4 text-center">
          No subscriptions yet. Use the <strong>Subscribe</strong> bell on a project page to get started.
        </div>

        <div class="space-y-2">
          <div
            v-for="sub in subs"
            :key="sub.id"
            class="flex items-center gap-3 rounded-lg border border-default px-4 py-3"
            :class="isMuted(sub) ? 'opacity-60' : ''"
          >
            <UIcon :name="channelTypeIcon(sub.channel.type)" class="size-5 text-muted shrink-0" />
            <div class="flex-1 min-w-0 space-y-0.5">
              <div class="font-medium text-sm">{{ sub.channel.name }}</div>
              <div class="text-xs text-muted flex flex-wrap gap-x-3">
                <span v-if="sub.projectId">Project #{{ sub.projectId }}</span>
                <span v-else>All projects</span>
                <span>{{ sub.mode }}</span>
                <span v-if="isMuted(sub)" class="text-warning-500"
                  >Muted until {{ new Date(sub.mutedUntil!).toLocaleDateString() }}</span
                >
              </div>
              <div class="flex flex-wrap gap-1 mt-1">
                <UBadge v-for="e in sub.events ?? []" :key="e" size="xs" variant="soft" color="neutral">
                  {{ eventLabel(e) }}
                </UBadge>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <UButton
                :icon="isMuted(sub) ? 'i-lucide-bell' : 'i-lucide-bell-off'"
                color="neutral"
                variant="ghost"
                size="sm"
                :title="isMuted(sub) ? 'Unmute' : 'Mute for 7 days'"
                @click="toggleMute(sub)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                title="Remove subscription"
                @click="deleteSub(sub.id)"
              />
            </div>
          </div>
        </div>
      </SectionCard>
    </template>

    <UAlert
      v-else
      color="info"
      icon="i-lucide-info"
      title="Authentication required"
      description="Channels and subscriptions require authentication (PIWI_AUTH_ENABLED=true)."
    />
  </div>
</template>
