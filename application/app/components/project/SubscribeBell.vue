<script setup lang="ts">
import type { NotificationEvent } from '#shared/notification-events';
import { NOTIFICATION_EVENTS } from '#shared/notification-events';

const props = defineProps<{ projectId: number }>();

const config = useRuntimeConfig();
const authEnabled = computed(() => config.public.authEnabled);
const { authState } = useAuth();
const isAuthenticated = computed(() => authState.value.authenticated);

const toast = useToast();
const open = ref(false);

// ── Subscriptions for this project ─────────────────────────────────────────
interface Subscription {
  id: number;
  events: string[];
  mode: string;
  mutedUntil: string | null;
  active: boolean;
  channel: { id: number; name: string; type: string };
}

const shouldFetch = authEnabled.value && isAuthenticated.value;

const { data: subsData, refresh: refreshSubs } = await useFetch<{ subscriptions: Subscription[] }>(
  `/api/subscriptions?projectId=${props.projectId}`,
  { immediate: shouldFetch },
);

const subs = computed(() => subsData.value?.subscriptions ?? []);
const isSubscribed = computed(() => subs.value.length > 0);

// ── Channels ─────────────────────────────────────────────────────────────────
interface Channel {
  id: number;
  name: string;
  type: string;
  config?: Record<string, unknown>;
}

const { data: channelsData } = await useFetch<{ channels: Channel[] }>('/api/channels', { immediate: shouldFetch });

const channels = computed(() => channelsData.value?.channels ?? []);

// ── New subscription form ─────────────────────────────────────────────────────
const showForm = ref(false);
const selectedChannelId = ref<number | null>(null);
const selectedEvents = ref<string[]>(['run.failed']);
const subscribing = ref(false);

// ── Edit subscription ─────────────────────────────────────────────────────────
const editingSub = ref<Subscription | null>(null);
const editChannelId = ref<number | null>(null);
const editEvents = ref<string[]>([]);
const savingEdit = ref(false);

function startEdit(sub: Subscription) {
  editingSub.value = sub;
  editChannelId.value = sub.channel.id;
  editEvents.value = [...sub.events];
}

function cancelEdit() {
  editingSub.value = null;
}

async function saveEdit() {
  if (!editingSub.value || !editChannelId.value || editEvents.value.length === 0) return;
  savingEdit.value = true;
  try {
    await $fetch(`/api/subscriptions/${editingSub.value.id}`, {
      method: 'PATCH',
      body: { channelId: editChannelId.value, events: editEvents.value as NotificationEvent[] },
    });
    await refreshSubs();
    editingSub.value = null;
  } catch (e) {
    toast.add({ title: 'Update failed', description: String((e as Error)?.message ?? e), color: 'error' });
  } finally {
    savingEdit.value = false;
  }
}

const channelItems = computed(() =>
  channels.value.map((c) => ({
    label: c.type === 'personal_email' ? `${c.name} (${(c.config as Record<string, unknown>).address})` : c.name,
    value: c.id,
  })),
);

const eventItems = NOTIFICATION_EVENTS.map((e) => ({
  label: e.replace(/\./g, ' › '),
  value: e,
}));

watch(open, (val) => {
  if (val) {
    refreshSubs();
    if (channels.value.length > 0 && !selectedChannelId.value) {
      selectedChannelId.value = channels.value[0]!.id;
    }
  } else {
    showForm.value = false;
    editingSub.value = null;
  }
});

async function subscribe() {
  if (!selectedChannelId.value || selectedEvents.value.length === 0) return;
  subscribing.value = true;
  try {
    await $fetch('/api/subscriptions', {
      method: 'POST',
      body: {
        channelId: selectedChannelId.value,
        projectId: props.projectId,
        events: selectedEvents.value,
        mode: 'realtime',
      },
    });
    await refreshSubs();
    showForm.value = false;
    toast.add({ title: 'Subscribed', color: 'success' });
  } catch (e) {
    toast.add({ title: 'Subscribe failed', description: String((e as Error)?.message ?? e), color: 'error' });
  } finally {
    subscribing.value = false;
  }
}

async function unsubscribe(id: number) {
  try {
    await $fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
    await refreshSubs();
    toast.add({ title: 'Unsubscribed', color: 'success' });
  } catch (e) {
    toast.add({ title: 'Failed', description: String((e as Error)?.message ?? e), color: 'error' });
  }
}

async function toggleMute(sub: Subscription) {
  const muted = sub.mutedUntil && new Date(sub.mutedUntil) > new Date();
  try {
    await $fetch(`/api/subscriptions/${sub.id}`, {
      method: 'PATCH',
      body: { mutedUntil: muted ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
    });
    await refreshSubs();
  } catch (e) {
    toast.add({ title: 'Failed', description: String((e as Error)?.message ?? e), color: 'error' });
  }
}

function isMuted(sub: Subscription) {
  return sub.mutedUntil && new Date(sub.mutedUntil) > new Date();
}

function channelIcon(type: string) {
  if (type === 'personal_email') return 'i-lucide-user-round';
  if (type === 'email') return 'i-lucide-mail';
  if (type === 'slack') return 'i-lucide-slack';
  return 'i-lucide-webhook';
}
</script>

<template>
  <UPopover v-if="authEnabled && isAuthenticated" v-model:open="open" :ui="{ content: 'w-72' }">
    <UButton
      :icon="isSubscribed ? 'i-lucide-bell-ring' : 'i-lucide-bell'"
      size="sm"
      :color="isSubscribed ? 'primary' : 'neutral'"
      :variant="isSubscribed ? 'soft' : 'outline'"
      title="Notification subscriptions for this project"
    />

    <template #content>
      <div class="p-3 space-y-3">
        <div class="flex items-center justify-between">
          <span class="font-medium text-sm">Notifications</span>
          <UButton
            v-if="!showForm"
            size="xs"
            icon="i-lucide-plus"
            variant="ghost"
            color="neutral"
            :disabled="channels.length === 0"
            @click="showForm = true"
          >
            Add
          </UButton>
        </div>

        <!-- No channels hint -->
        <div v-if="channels.length === 0" class="text-xs text-muted text-center py-2">
          No channels configured.<br />
          <NuxtLink to="/settings/notifications" class="text-primary underline">Add one in Settings</NuxtLink>
        </div>

        <!-- Existing subscriptions -->
        <div v-if="subs.length > 0" class="space-y-1.5">
          <template v-for="sub in subs" :key="sub.id">
            <!-- Inline edit form -->
            <div
              v-if="editingSub?.id === sub.id"
              class="space-y-2 rounded border border-primary/30 bg-primary/5 px-2 py-2"
            >
              <UFormField label="Channel" size="xs">
                <USelect
                  v-model="editChannelId"
                  :items="channelItems"
                  value-key="value"
                  class="w-full text-xs"
                  size="xs"
                />
              </UFormField>
              <UFormField label="Events" size="xs">
                <div class="space-y-1">
                  <label
                    v-for="item in eventItems"
                    :key="item.value"
                    class="flex items-center gap-1.5 text-xs cursor-pointer"
                  >
                    <input type="checkbox" :value="item.value" v-model="editEvents" class="accent-primary size-3" />
                    {{ item.label }}
                  </label>
                </div>
              </UFormField>
              <div class="flex gap-1.5 justify-end">
                <UButton size="xs" color="neutral" variant="ghost" @click="cancelEdit">Cancel</UButton>
                <UButton
                  size="xs"
                  color="primary"
                  :loading="savingEdit"
                  :disabled="!editChannelId || editEvents.length === 0"
                  @click="saveEdit"
                >
                  Save
                </UButton>
              </div>
            </div>

            <!-- Normal row -->
            <div
              v-else
              class="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
              :class="isMuted(sub) ? 'opacity-60' : ''"
            >
              <UIcon :name="channelIcon(sub.channel.type)" class="size-3.5 text-muted shrink-0" />
              <span class="flex-1 font-medium truncate">{{ sub.channel.name }}</span>
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                title="Edit subscription"
                @click="startEdit(sub)"
              />
              <UButton
                :icon="isMuted(sub) ? 'i-lucide-bell' : 'i-lucide-bell-off'"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="isMuted(sub) ? 'Unmute' : 'Mute 7 days'"
                @click="toggleMute(sub)"
              />
              <UButton
                icon="i-lucide-x"
                color="error"
                variant="ghost"
                size="xs"
                title="Unsubscribe"
                @click="unsubscribe(sub.id)"
              />
            </div>
          </template>
        </div>

        <div v-else-if="!showForm && channels.length > 0" class="text-xs text-muted text-center py-1">
          Not subscribed to this project.
        </div>

        <!-- Subscribe form -->
        <div v-if="showForm" class="space-y-2 border-t border-default pt-2">
          <UFormField label="Channel" size="xs">
            <USelect
              v-model="selectedChannelId"
              :items="channelItems"
              value-key="value"
              class="w-full text-xs"
              size="xs"
            />
          </UFormField>
          <UFormField label="Events" size="xs">
            <div class="space-y-1">
              <label
                v-for="item in eventItems"
                :key="item.value"
                class="flex items-center gap-1.5 text-xs cursor-pointer"
              >
                <input type="checkbox" :value="item.value" v-model="selectedEvents" class="accent-primary size-3" />
                {{ item.label }}
              </label>
            </div>
          </UFormField>
          <div class="flex gap-1.5 justify-end">
            <UButton size="xs" color="neutral" variant="ghost" @click="showForm = false">Cancel</UButton>
            <UButton
              size="xs"
              color="primary"
              :loading="subscribing"
              :disabled="!selectedChannelId || selectedEvents.length === 0"
              @click="subscribe"
            >
              Subscribe
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
