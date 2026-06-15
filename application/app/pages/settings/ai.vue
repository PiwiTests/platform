<script setup lang="ts">
import type { AiSettings } from '~~/types/api';

const toast = useToast();

const { data: settings, refresh } = await useFetch<AiSettings>('/api/settings/ai');

const provider = ref<string | null>(null);
const model = ref<string>('');
const baseUrl = ref<string>('');
const apiKey = ref<string>('');
const autoDiagnose = ref(false);
const customInstructions = ref<string>('');
const scmToken = ref<string>('');
const saving = ref(false);
const savingInstructions = ref(false);
const savingScmToken = ref(false);
const testing = ref(false);

watch(
  settings,
  (val) => {
    if (!val) return;
    provider.value = val.provider || null;
    model.value = val.model || '';
    baseUrl.value = val.baseUrl || '';
    apiKey.value = '';
    autoDiagnose.value = val.autoDiagnose;
    customInstructions.value = val.customInstructions || '';
  },
  { immediate: true },
);

const providerOptions = [
  { label: 'None (disabled)', value: null },
  { label: 'Anthropic API', value: 'anthropic' },
  { label: 'OpenAI-compatible', value: 'openai' },
];

interface OpenAiPreset {
  label: string;
  baseUrl: string;
  model: string;
  apiKeyRequired: boolean;
}

const OPENAI_PRESETS: OpenAiPreset[] = [
  { label: 'ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', apiKeyRequired: false },
  { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: '', apiKeyRequired: false },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.1-8b-instruct',
    apiKeyRequired: true,
  },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', apiKeyRequired: true },
  {
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    apiKeyRequired: true,
  },
  { label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', apiKeyRequired: true },
  { label: 'Custom', baseUrl: '', model: '', apiKeyRequired: false },
];

const presetOptions = OPENAI_PRESETS.map((p) => ({ label: p.label, value: p.label }));

function applyPreset(label: string) {
  const preset = OPENAI_PRESETS.find((p) => p.label === label);
  if (!preset || preset.label === 'Custom') return;
  baseUrl.value = preset.baseUrl;
  model.value = preset.model;
}

async function save() {
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      provider: provider.value || null,
      model: model.value || undefined,
      baseUrl: baseUrl.value || undefined,
      autoDiagnose: autoDiagnose.value,
    };
    if (apiKey.value !== '') {
      body.apiKey = apiKey.value;
    }
    await $fetch('/api/settings/ai', { method: 'PUT', body });
    await refresh();
    apiKey.value = '';
    toast.add({ title: 'Settings saved', color: 'success' });
  } catch (err) {
    toast.add({ title: 'Save failed', description: String((err as Error)?.message ?? err), color: 'error' });
  } finally {
    saving.value = false;
  }
}

async function saveScmToken() {
  savingScmToken.value = true;
  try {
    await $fetch('/api/settings/ai', {
      method: 'PUT',
      body: { scmToken: scmToken.value || null },
    });
    await refresh();
    scmToken.value = '';
    toast.add({ title: 'SCM token saved', color: 'success' });
  } catch (err) {
    toast.add({ title: 'Save failed', description: String((err as Error)?.message ?? err), color: 'error' });
  } finally {
    savingScmToken.value = false;
  }
}

async function saveInstructions() {
  savingInstructions.value = true;
  try {
    await $fetch('/api/settings/ai', {
      method: 'PUT',
      body: { customInstructions: customInstructions.value || null },
    });
    await refresh();
    toast.add({ title: 'Instructions saved', color: 'success' });
  } catch (err) {
    toast.add({ title: 'Save failed', description: String((err as Error)?.message ?? err), color: 'error' });
  } finally {
    savingInstructions.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  try {
    const res = await $fetch<{ success: boolean; model?: string; error?: string }>('/api/settings/ai/test', {
      method: 'POST',
      body: {
        provider: provider.value,
        apiKey: apiKey.value || undefined,
        model: model.value || undefined,
        baseUrl: baseUrl.value || undefined,
      },
    });
    if (res.success) {
      toast.add({ title: 'Connection successful', description: `Model: ${res.model}`, color: 'success' });
    } else {
      toast.add({ title: 'Connection failed', description: res.error || 'Unknown error', color: 'error' });
    }
  } catch (err) {
    toast.add({ title: 'Connection failed', description: String((err as Error)?.message ?? err), color: 'error' });
  } finally {
    testing.value = false;
  }
}

const envVars = computed(() => {
  if (!provider.value) return null;
  const lines: string[] = [];
  lines.push(`PIWI_AI_PROVIDER=${provider.value}`);
  if (model.value) lines.push(`PIWI_AI_MODEL=${model.value}`);
  if (baseUrl.value) lines.push(`PIWI_AI_BASE_URL=${baseUrl.value}`);
  const keyDisplay = apiKey.value
    ? apiKey.value
    : settings.value?.hasApiKey
      ? '(use existing stored key)'
      : 'your-api-key-here';
  lines.push(`PIWI_AI_API_KEY=${keyDisplay}`);
  lines.push(`PIWI_AI_AUTO_DIAGNOSE=${autoDiagnose.value ? 'true' : 'false'}`);
  return lines.join('\n');
});
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar title="AI Diagnosis" />

    <div class="max-w-2xl mx-auto p-6 space-y-6">
      <UAlert
        v-if="settings?.envManaged"
        color="info"
        icon="i-lucide-info"
        title="Configuration managed by environment variables"
        description="PIWI_AI_* environment variables are set. The form below reflects the current environment configuration and cannot be changed here."
      />

      <UCard>
        <template #header>
          <h3 class="font-semibold">Provider configuration</h3>
        </template>

        <div class="space-y-4">
          <UFormField label="Provider">
            <USelect v-model="provider" :items="providerOptions" :disabled="settings?.envManaged" class="w-full" />
          </UFormField>

          <template v-if="provider">
            <UFormField
              v-if="provider === 'openai'"
              label="Preset"
              description="Pick a known provider to auto-fill the URL and model, then adjust as needed"
            >
              <USelect
                :items="presetOptions"
                placeholder="Choose a preset…"
                :disabled="settings?.envManaged"
                class="w-full"
                @update:model-value="applyPreset"
              />
            </UFormField>

            <UFormField
              label="API key"
              :description="
                settings?.hasApiKey
                  ? 'Leave empty to keep the stored key, clear and save to remove it'
                  : 'Required for Anthropic; optional for local OpenAI-compatible servers'
              "
            >
              <UInput
                v-model="apiKey"
                type="password"
                :placeholder="settings?.hasApiKey ? '•••••••• (unchanged)' : 'sk-ant-...'"
                :disabled="settings?.envManaged"
                class="w-full font-mono"
              />
            </UFormField>

            <UFormField
              label="Model"
              :description="
                provider === 'anthropic' ? 'Default: claude-opus-4-8' : 'Required, e.g. llama3.1, gpt-4o, mistral'
              "
            >
              <UInput
                v-model="model"
                :placeholder="provider === 'anthropic' ? 'claude-opus-4-8' : 'e.g. llama3.1, gpt-4o'"
                :disabled="settings?.envManaged"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Base URL"
              :description="
                provider === 'openai' ? 'Required, e.g. http://localhost:11434/v1' : 'Optional proxy override'
              "
            >
              <UInput
                v-model="baseUrl"
                :placeholder="
                  provider === 'openai' ? 'http://localhost:11434/v1' : 'https://api.anthropic.com (default)'
                "
                :disabled="settings?.envManaged"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Auto-diagnose">
              <div class="flex items-center gap-3">
                <USwitch v-model="autoDiagnose" :disabled="settings?.envManaged" />
                <span class="text-sm text-gray-500"
                  >Automatically diagnose new failure clusters when a run finishes — one LLM call per new cluster, max 3
                  per run</span
                >
              </div>
            </UFormField>
          </template>
        </div>

        <template #footer>
          <div class="flex items-center gap-2 justify-end">
            <UButton
              color="neutral"
              variant="soft"
              :loading="testing"
              :disabled="!provider"
              icon="i-lucide-plug"
              @click="testConnection"
            >
              Test connection
            </UButton>
            <UButton
              color="primary"
              :loading="saving"
              :disabled="settings?.envManaged"
              icon="i-lucide-save"
              @click="save"
            >
              Save
            </UButton>
          </div>
        </template>
      </UCard>

      <UCard>
        <template #header>
          <div>
            <h3 class="font-semibold">Repository access</h3>
            <p class="text-sm text-gray-500 mt-0.5">
              Optional SCM token used to fetch changed files between the last passing and current failing run. Works
              with GitHub, GitLab, and Bitbucket. Without a token, only public repositories are accessible (60 req/hr
              rate limit). Required for private repositories. Per-project tokens can be set in the project edit page.
            </p>
          </div>
        </template>

        <UFormField
          label="SCM token"
          :description="
            settings?.hasScmToken
              ? 'Leave empty to keep the stored token, enter a new value to replace it, or save empty to remove it'
              : 'Personal access token with read access to repository contents. Supports GitHub (ghp_), GitLab (glpat-), and Bitbucket tokens.'
          "
        >
          <UInput
            v-model="scmToken"
            type="password"
            :placeholder="settings?.hasScmToken ? '•••••••• (unchanged)' : 'ghp_..., glpat-..., or Bitbucket token'"
            class="w-full font-mono"
          />
        </UFormField>

        <template #footer>
          <div class="flex justify-end">
            <UButton color="primary" :loading="savingScmToken" icon="i-lucide-save" @click="saveScmToken">
              Save token
            </UButton>
          </div>
        </template>
      </UCard>

      <UCard>
        <template #header>
          <div>
            <h3 class="font-semibold">Global analysis instructions</h3>
            <p class="text-sm text-gray-500 mt-0.5">
              Applied to every diagnosis, across all projects. Use this to set general preferences: preferred
              remediation steps, tone, focus areas, or output format.
            </p>
          </div>
        </template>

        <UTextarea
          v-model="customInstructions"
          :rows="6"
          placeholder="e.g. Always suggest running failing tests with --repeat-each 5 to confirm flakiness. Prefer network-level evidence over ARIA snapshots. Recommend git bisect when a commit range is available."
          class="w-full font-mono text-sm"
        />

        <p class="text-xs text-gray-400 mt-2">
          These instructions are appended to the base system prompt. They shape how the AI analyzes failures but cannot
          override the response schema or confidence requirement.
        </p>

        <template #footer>
          <div class="flex justify-end">
            <UButton color="primary" :loading="savingInstructions" icon="i-lucide-save" @click="saveInstructions">
              Save instructions
            </UButton>
          </div>
        </template>
      </UCard>

      <UCard v-if="!settings?.envManaged && provider && envVars">
        <template #header>
          <h3 class="font-semibold">Environment variables</h3>
        </template>
        <p class="text-sm text-gray-500 mb-3">
          Use these environment variables instead of storing credentials in the database:
        </p>
        <CodeBlock :code="envVars!" lang="bash" />
      </UCard>

      <UCard>
        <template #header>
          <h3 class="font-semibold">Privacy notice</h3>
        </template>
        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p>When diagnosing a failure cluster, the following data is sent to the configured LLM provider:</p>
          <ul class="list-disc list-inside space-y-1 ml-2">
            <li>Normalized error signature and sample raw error text</li>
            <li>Test titles and file paths for affected tests</li>
            <li>Browser info, test steps, console error/warning entries (excerpts)</li>
            <li>Failed network request URLs and status codes</li>
            <li>ARIA page snapshot (if collected)</li>
            <li>
              Commit SHA range since last passing run, plus changed file names and diff patches fetched from
              GitHub/GitLab/Bitbucket (if a repository token is configured or the repo is public)
            </li>
          </ul>
          <p class="mt-2">
            The API key is stored plaintext in the application database (admin-only access). For stricter setups, use
            <code class="font-mono text-xs">PIWI_AI_API_KEY</code> instead of the UI.
          </p>
        </div>
      </UCard>
    </div>
  </UDashboardPanel>
</template>
