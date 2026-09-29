<script setup lang="ts">
// Where Piwi Picker, the VS Code extension or the JetBrains plugin sends the
// user to allow a connection (an RFC 8628 device authorization): the client
// shows the same code and polls until the signed-in user answers. The auth
// middleware signs the user in first and comes back here. The link carries the
// code, so anyone can send one: Allow stays disabled until the user confirms
// their own client shows it (RFC 8628 §5.4).
import type { ConnectRequestView } from '~~/server/utils/extension-connect';

definePageMeta({ layout: false });
const PICKER = {
  title: 'Connect Piwi Picker',
  start: 'clicked Connect in Piwi Picker',
  keyName: 'this browser',
  confirm: 'My Piwi Picker shows this same code',
  client: 'Piwi Picker',
  tick: 'Tick the box once Piwi Picker shows this same code',
  again: 'Start again from Piwi Picker’s settings.',
};
const EDITOR = {
  title: 'Connect your editor',
  start: 'run Piwi: Connect in your editor',
  keyName: 'this editor',
  confirm: 'My editor shows this same code',
  client: 'Your editor',
  tick: 'Tick the box once your editor shows this same code',
  again: 'Start again from Piwi: Connect in your editor.',
};

const route = useRoute();
const config = useRuntimeConfig();
const { authState } = useAuth();

const code = computed(() => (typeof route.query.code === 'string' ? route.query.code : ''));
const request = ref<ConnectRequestView | null>(null);
const loadError = ref('');
const loading = ref(true);
const deciding = ref<'allow' | 'deny' | null>(null);
const decideError = ref('');
const codeConfirmed = ref(false);
const words = computed(() => (request.value?.clientKind === 'editor' ? EDITOR : PICKER));

useHead({ title: () => words.value.title });

const signedInAs = computed(() => {
  const user = authState.value.user;
  return config.public.authEnabled && user ? user.name || user.username : null;
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    request.value = await $fetch<ConnectRequestView>('/api/extension/connect/request', {
      query: { code: code.value },
    });
  } catch (err) {
    request.value = null;
    loadError.value = errorMessage(err, 'This connection request could not be loaded.');
  } finally {
    loading.value = false;
  }
}

async function decide(allow: boolean) {
  if (!request.value) return;
  deciding.value = allow ? 'allow' : 'deny';
  decideError.value = '';
  try {
    const answer = await $fetch<{ status: ConnectRequestView['status'] }>('/api/extension/connect/decision', {
      method: 'POST',
      body: { userCode: request.value.userCode, allow },
    });
    request.value = { ...request.value, status: answer.status };
  } catch (err) {
    decideError.value = errorMessage(err, 'The answer could not be saved.');
    await load();
  } finally {
    deciding.value = null;
  }
}

onMounted(() => {
  if (config.public.demoMode) {
    loading.value = false;
    loadError.value = 'The demo has no server to connect to.';
    return;
  }
  if (!code.value) {
    loading.value = false;
    loadError.value = 'This link has no code. Start again from Piwi Picker’s settings or Piwi: Connect in your editor.';
    return;
  }
  void load();
});
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-elevated/50 gap-6 px-4 py-8">
    <img src="/logo-wide.svg" alt="Piwi Dashboard" class="h-16 rounded-xl" />

    <UCard class="w-full max-w-md" data-shot="extension-connect">
      <template #header>
        <h1 class="text-lg sm:text-xl font-semibold text-highlighted">{{ words.title }}</h1>
      </template>

      <LoadingState v-if="loading" text="Loading…" />

      <div v-else-if="loadError" class="space-y-2">
        <p class="text-sm text-highlighted leading-relaxed">{{ loadError }}</p>
      </div>

      <div v-else-if="request" class="space-y-5">
        <p
          class="text-lg sm:text-xl font-semibold text-highlighted font-mono tracking-widest text-center"
          data-testid="connect-code"
        >
          {{ request.userCode }}
        </p>
        <dl class="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt class="font-semibold text-highlighted">Client</dt>
          <dd class="text-highlighted" data-testid="connect-client">{{ request.clientName }}</dd>
          <template v-if="signedInAs">
            <dt class="font-semibold text-highlighted">Account</dt>
            <dd class="text-highlighted">{{ signedInAs }}</dd>
          </template>
        </dl>

        <template v-if="request.status === 'pending'">
          <p class="text-sm text-highlighted leading-relaxed">
            If you have not just {{ words.start }}, deny: someone may have sent you this link to get access in your
            name.
            <template v-if="config.public.authEnabled">
              Allowing creates an API key named after {{ words.keyName }}, with your role and project access. You can
              revoke it in your account’s API keys.
            </template>
            <template v-else>
              Authentication is off on this instance, so no key is needed: allowing only confirms the connection.
            </template>
          </p>
          <UCheckbox v-model="codeConfirmed" :label="words.confirm" data-testid="connect-code-confirm" />
          <UAlert v-if="decideError" color="error" variant="subtle" :title="decideError" />
          <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Deny"
              :loading="deciding === 'deny'"
              :disabled="deciding !== null"
              class="justify-center"
              @click="decide(false)"
            />
            <UButton
              color="primary"
              label="Allow"
              :title="words.tick"
              :loading="deciding === 'allow'"
              :disabled="deciding !== null || !codeConfirmed"
              class="justify-center"
              @click="decide(true)"
            />
          </div>
        </template>

        <p v-else-if="request.status === 'approved' || request.status === 'consumed'" class="text-sm text-highlighted">
          Allowed. {{ words.client }} finishes connecting on its own; you can close this tab.
        </p>
        <p v-else-if="request.status === 'denied'" class="text-sm text-highlighted">
          Denied. {{ words.client }} was not connected.
        </p>
        <p v-else class="text-sm text-highlighted">This request has expired. {{ words.again }}</p>
      </div>
    </UCard>
  </div>
</template>
