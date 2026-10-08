<script setup lang="ts">
// Where an MCP client's sign-in lands (the OAuth authorization code flow): the
// authorize endpoint stored the client's request and sent the browser here with
// its id. The auth middleware signs the user in first and comes back here.
// Allowing sends the browser back to the client with a code; the client name is
// whatever the client registered, so the page also says where the answer goes.
import type { AuthorizationRequestView } from '~~/server/utils/mcp-oauth';

definePageMeta({ layout: false });
useHead({ title: 'Connect an MCP client' });

/** The authorize endpoint's refusals, when there is no client to send the answer to. */
const START_ERRORS: Record<string, string> = {
  invalid_client:
    'This MCP client is not registered on this instance. Remove the server from your client and add it again: it registers on its own.',
  invalid_redirect_uri:
    'The client asked to return to an address it did not register, so nothing was sent to it. Remove the server from your client and add it again.',
};

const route = useRoute();
const config = useRuntimeConfig();
const { authState } = useAuth();

const requestId = computed(() => (typeof route.query.request === 'string' ? route.query.request : ''));
const request = ref<AuthorizationRequestView | null>(null);
const loadError = ref('');
const loading = ref(true);
const deciding = ref<'allow' | 'deny' | null>(null);
const decideError = ref('');
const leaving = ref(false);

const signedInAs = computed(() => {
  const user = authState.value.user;
  return user ? user.name || user.username : null;
});

const returnsTo = computed(() => {
  const redirect = request.value?.redirect;
  if (!redirect) return '';
  if (redirect.kind === 'loopback') return 'An application on this computer';
  if (redirect.kind === 'app') return `The application that opens ${redirect.label}:// links`;
  return redirect.label;
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    request.value = await $fetch<AuthorizationRequestView>(
      `/api/oauth/authorizations/${encodeURIComponent(requestId.value)}`,
    );
  } catch (err) {
    request.value = null;
    loadError.value = errorMessage(err, 'This authorization request could not be loaded.');
  } finally {
    loading.value = false;
  }
}

async function decide(allow: boolean) {
  if (!request.value) return;
  deciding.value = allow ? 'allow' : 'deny';
  decideError.value = '';
  try {
    const answer = await $fetch<{ status: 'approved' | 'denied'; redirectTo: string }>(
      `/api/oauth/authorizations/${encodeURIComponent(requestId.value)}/decision`,
      { method: 'POST', body: { allow } },
    );
    request.value = { ...request.value, status: answer.status };
    leaving.value = true;
    window.location.assign(answer.redirectTo);
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
  const startError = typeof route.query.error === 'string' ? route.query.error : '';
  if (startError) {
    loading.value = false;
    loadError.value = START_ERRORS[startError] ?? 'The client sent a request this instance cannot answer.';
    return;
  }
  if (!requestId.value) {
    loading.value = false;
    loadError.value = 'This link has no request. Connect again from your MCP client.';
    return;
  }
  void load();
});
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-elevated/50 gap-6 px-4 py-8">
    <img src="/logo-wide.svg" alt="Piwi Dashboard" class="h-16 rounded-xl" />

    <UCard class="w-full max-w-md" data-shot="mcp-oauth-consent">
      <template #header>
        <h1 class="text-lg sm:text-xl font-semibold text-highlighted">Connect an MCP client</h1>
      </template>

      <LoadingState v-if="loading" text="Loading…" />

      <p v-else-if="loadError" class="text-sm text-highlighted leading-relaxed">{{ loadError }}</p>

      <div v-else-if="request" class="space-y-5">
        <dl class="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt class="font-semibold text-highlighted">Client</dt>
          <dd class="min-w-0">
            <span class="text-highlighted break-words" data-testid="oauth-client">{{ request.clientName }}</span>
            <span class="block text-xs text-muted">The name the client gave itself</span>
          </dd>
          <dt class="font-semibold text-highlighted">Returns to</dt>
          <dd class="text-highlighted break-words" data-testid="oauth-returns-to">{{ returnsTo }}</dd>
          <template v-if="signedInAs">
            <dt class="font-semibold text-highlighted">Account</dt>
            <dd class="text-highlighted break-words">{{ signedInAs }}</dd>
          </template>
        </dl>

        <template v-if="request.status === 'pending'">
          <p class="text-sm text-highlighted leading-relaxed">
            Allowing lets this client use the MCP server with your role and project access: the read tools, and the
            triage tools where your role allows them. The connection is listed with your API keys, named after the
            client, and you can revoke it there.
          </p>
          <p class="text-sm text-highlighted leading-relaxed">
            If you have not just added this Piwi instance to an AI assistant or an editor, deny: someone may have sent
            you this link to get access in your name.
          </p>
          <UAlert v-if="decideError" color="error" variant="subtle" :title="decideError" />
          <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Deny"
              :loading="deciding === 'deny'"
              :disabled="deciding !== null || leaving"
              class="justify-center"
              @click="decide(false)"
            />
            <UButton
              color="primary"
              label="Allow"
              :loading="deciding === 'allow'"
              :disabled="deciding !== null || leaving"
              class="justify-center"
              @click="decide(true)"
            />
          </div>
        </template>

        <p v-else-if="request.status === 'approved' || request.status === 'consumed'" class="text-sm text-highlighted">
          Allowed. The client finishes connecting on its own; you can close this tab.
        </p>
        <p v-else-if="request.status === 'denied'" class="text-sm text-highlighted">
          Denied. The client was not connected; you can close this tab.
        </p>
        <p v-else class="text-sm text-highlighted">This request has expired. Connect again from your MCP client.</p>
      </div>
    </UCard>
  </div>
</template>
