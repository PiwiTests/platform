<script setup lang="ts">
import {
  INTEGRATION_PROVIDER_LIST,
  type CredentialField,
  type IntegrationProviderName,
} from '#shared/integrations/registry';
import type { ConnectionSummary, ConnectionTestResult } from '#shared/integrations/types';
import type { PiwiEnvVarName } from '#shared/piwi-env-vars';

const toast = useToast();
const { data, refresh } = await useFetch<{ connections: ConnectionSummary[] }>('/api/integrations/connections', {
  default: () => ({ connections: [] as ConnectionSummary[] }),
});

const connections = computed(() => data.value?.connections ?? []);
function connectionsFor(provider: IntegrationProviderName): ConnectionSummary[] {
  return connections.value.filter((c) => c.provider === provider);
}

/** Env vars that back an environment-managed connection, per provider. */
const ENV_VARS_BY_PROVIDER: Partial<Record<IntegrationProviderName, PiwiEnvVarName[]>> = {
  jira: ['PIWI_JIRA_BASE_URL', 'PIWI_JIRA_EMAIL', 'PIWI_JIRA_API_TOKEN'],
};

function statusColor(status: ConnectionSummary['status']): 'success' | 'error' | 'neutral' {
  if (status === 'ok') return 'success';
  if (status === 'failed') return 'error';
  return 'neutral';
}
function statusLabel(status: ConnectionSummary['status']): string {
  if (status === 'ok') return 'Verified';
  if (status === 'failed') return 'Failed';
  return 'Unverified';
}

// ── Connect / edit form ────────────────────────────────────────────────────
interface FormState {
  provider: IntegrationProviderName | null;
  editingId: number | null;
  name: string;
  baseUrl: string;
  credentials: Record<string, string>;
}
const form = reactive<FormState>({ provider: null, editingId: null, name: '', baseUrl: '', credentials: {} });
const saving = ref(false);

function providerMeta(provider: IntegrationProviderName) {
  return INTEGRATION_PROVIDER_LIST.find((p) => p.name === provider)!;
}

function credentialFieldsFor(provider: IntegrationProviderName): readonly CredentialField[] {
  return providerMeta(provider).credentialFields;
}

function openCreate(provider: IntegrationProviderName) {
  form.provider = provider;
  form.editingId = null;
  form.name = '';
  form.baseUrl = '';
  form.credentials = {};
}

function openEdit(conn: ConnectionSummary) {
  form.provider = conn.provider;
  form.editingId = conn.id;
  form.name = conn.name;
  form.baseUrl = conn.baseUrl;
  form.credentials = {};
}

function cancel() {
  form.provider = null;
  form.editingId = null;
}

const isEditing = computed(() => form.editingId !== null);

async function submit() {
  if (!form.provider) return;
  saving.value = true;
  try {
    const body = { provider: form.provider, name: form.name, baseUrl: form.baseUrl, credentials: form.credentials };
    if (form.editingId !== null) {
      await $fetch(`/api/integrations/connections/${form.editingId}`, { method: 'PATCH', body });
      toast.add({ title: 'Connection updated', color: 'success' });
    } else {
      await $fetch('/api/integrations/connections', { method: 'POST', body });
      toast.add({ title: 'Connection added', color: 'success' });
    }
    cancel();
    await refresh();
  } catch (err) {
    toast.add({ title: 'Save failed', description: errorMessage(err), color: 'error' });
  } finally {
    saving.value = false;
  }
}

// ── Test / delete ──────────────────────────────────────────────────────────
const testing = ref<number | null>(null);
const testResults = reactive<Record<number, ConnectionTestResult>>({});

async function testConnection(conn: ConnectionSummary) {
  testing.value = conn.id;
  try {
    testResults[conn.id] = await $fetch<ConnectionTestResult>(`/api/integrations/connections/${conn.id}/test`, {
      method: 'POST',
    });
    await refresh();
  } catch (err) {
    testResults[conn.id] = { ok: false, error: errorMessage(err) };
  } finally {
    testing.value = null;
  }
}

const deleting = ref<number | null>(null);
async function removeConnection(conn: ConnectionSummary) {
  deleting.value = conn.id;
  try {
    await $fetch(`/api/integrations/connections/${conn.id}`, { method: 'DELETE' });
    toast.add({ title: 'Connection removed', color: 'success' });
    await refresh();
  } catch (err) {
    toast.add({ title: 'Delete failed', description: errorMessage(err), color: 'error' });
  } finally {
    deleting.value = null;
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
</script>

<template>
  <div class="space-y-6" data-shot="integrations-settings">
    <SectionCard
      v-for="provider in INTEGRATION_PROVIDER_LIST"
      :key="provider.name"
      :icon="provider.icon"
      :title="provider.label"
      help="settings.integrations"
    >
      <template #subtitle>
        Connect {{ provider.label }} so pinned links unfurl with a title and status, and refresh through the connection.
      </template>

      <div class="space-y-4">
        <!-- Existing connections -->
        <EmptyState
          v-if="connectionsFor(provider.name).length === 0 && form.provider !== provider.name"
          icon="i-lucide-plug-zap"
          :text="`No ${provider.label} connection yet.`"
        />

        <ul v-else class="space-y-3">
          <li
            v-for="conn in connectionsFor(provider.name)"
            :key="conn.id"
            class="rounded-lg border border-default p-3 sm:p-4 space-y-3"
          >
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-sm font-medium text-highlighted">{{ conn.name }}</span>
              <UBadge :color="statusColor(conn.status)" variant="subtle" size="sm">{{
                statusLabel(conn.status)
              }}</UBadge>
              <EnvManagedBadge v-if="conn.managedBy === 'env'" :env-vars="ENV_VARS_BY_PROVIDER[provider.name]" />
            </div>
            <p class="text-xs text-muted font-mono break-all">{{ conn.baseUrl }}</p>

            <ErrorText v-if="conn.status === 'failed' && conn.lastError" :text="conn.lastError" />
            <p v-if="testResults[conn.id]?.ok" class="text-xs text-muted">
              Resolved account: {{ testResults[conn.id]?.account?.displayName }}
            </p>
            <ErrorText
              v-else-if="testResults[conn.id] && !testResults[conn.id]?.ok"
              :text="testResults[conn.id]?.error ?? 'Test failed'"
            />

            <div class="flex flex-wrap items-center gap-2">
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-plug"
                :loading="testing === conn.id"
                label="Test connection"
                @click="testConnection(conn)"
              />
              <template v-if="conn.managedBy === 'db'">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-pencil"
                  label="Edit"
                  @click="openEdit(conn)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-trash-2"
                  label="Remove"
                  :loading="deleting === conn.id"
                  @click="removeConnection(conn)"
                />
              </template>
            </div>
          </li>
        </ul>

        <!-- Connect / edit form -->
        <form
          v-if="form.provider === provider.name"
          class="rounded-lg border border-default p-3 sm:p-4 space-y-4"
          @submit.prevent="submit"
        >
          <p class="text-sm font-medium text-highlighted">
            {{ isEditing ? 'Edit connection' : `Connect ${provider.label}` }}
            <HelpHint topic="settings.integrations.connection" />
          </p>

          <UFormField label="Name" description="A label for this connection.">
            <UInput v-model="form.name" placeholder="Team Jira" class="w-full max-w-md" />
          </UFormField>

          <UFormField label="Base URL" description="The system’s address, e.g. https://your-team.atlassian.net.">
            <UInput v-model="form.baseUrl" placeholder="https://your-team.atlassian.net" class="w-full max-w-md" />
          </UFormField>

          <UFormField
            v-for="field in credentialFieldsFor(provider.name)"
            :key="field.key"
            :label="field.label"
            :description="field.help"
          >
            <UInput
              v-model="form.credentials[field.key]"
              :type="field.type === 'password' ? 'password' : 'text'"
              :placeholder="isEditing && field.secret ? 'Leave blank to keep the stored value' : field.placeholder"
              class="w-full max-w-md"
            />
          </UFormField>

          <div class="flex items-center gap-2">
            <UButton type="submit" color="primary" :loading="saving" icon="i-lucide-save">
              {{ isEditing ? 'Save' : 'Connect' }}
            </UButton>
            <UButton type="button" color="neutral" variant="ghost" label="Cancel" @click="cancel" />
          </div>
        </form>

        <div v-else-if="form.provider === null">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-plus"
            :label="`Connect ${provider.label}`"
            @click="openCreate(provider.name)"
          />
        </div>
      </div>

      <template #footer>
        <p class="text-xs text-muted">
          A connection base URL is administrator-supplied and trusted, so a self-hosted tracker on a private host works.
          <HelpHint topic="settings.integrations.private-host" />
        </p>
      </template>
    </SectionCard>
  </div>
</template>
