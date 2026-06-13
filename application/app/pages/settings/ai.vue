<script setup lang="ts">
interface AiSettings {
  provider: string | null
  model: string | null
  baseUrl: string | null
  autoDiagnose: boolean
  hasApiKey: boolean
  envManaged: boolean
}

const toast = useToast()

const { data: settings, refresh } = await useFetch<AiSettings>('/api/settings/ai')

const provider = ref<string>('')
const model = ref<string>('')
const baseUrl = ref<string>('')
const apiKey = ref<string>('')
const autoDiagnose = ref(false)
const saving = ref(false)
const testing = ref(false)

watch(settings, (val) => {
  if (!val) return
  provider.value = val.provider || ''
  model.value = val.model || ''
  baseUrl.value = val.baseUrl || ''
  apiKey.value = ''
  autoDiagnose.value = val.autoDiagnose
}, { immediate: true })

const providerOptions = [
  { label: 'None (disabled)', value: '' },
  { label: 'Anthropic API', value: 'anthropic' },
  { label: 'OpenAI-compatible (ollama, vLLM, OpenRouter…)', value: 'openai' }
]

async function save() {
  saving.value = true
  try {
    const body: Record<string, unknown> = {
      provider: provider.value || null,
      model: model.value || undefined,
      baseUrl: baseUrl.value || undefined,
      autoDiagnose: autoDiagnose.value
    }
    if (apiKey.value !== '') {
      body.apiKey = apiKey.value
    }
    await $fetch('/api/settings/ai', { method: 'PUT', body })
    await refresh()
    apiKey.value = ''
    toast.add({ title: 'Settings saved', color: 'success' })
  } catch (err) {
    toast.add({ title: 'Save failed', description: String((err as Error)?.message ?? err), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  try {
    const res = await $fetch<{ success: boolean, model?: string, error?: string }>('/api/settings/ai/test', { method: 'POST' })
    if (res.success) {
      toast.add({ title: 'Connection successful', description: `Model: ${res.model}`, color: 'success' })
    } else {
      toast.add({ title: 'Connection failed', description: res.error || 'Unknown error', color: 'error' })
    }
  } catch (err) {
    toast.add({ title: 'Connection failed', description: String((err as Error)?.message ?? err), color: 'error' })
  } finally {
    testing.value = false
  }
}
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
        description="NUXT_AI_* environment variables are set. The form below reflects the current environment configuration and cannot be changed here."
      />

      <UCard>
        <template #header>
          <h3 class="font-semibold">
            Provider configuration
          </h3>
        </template>

        <div class="space-y-4">
          <UFormField label="Provider">
            <USelect
              v-model="provider"
              :items="providerOptions"
              :disabled="settings?.envManaged"
              class="w-full"
            />
          </UFormField>

          <template v-if="provider">
            <UFormField
              label="API key"
              :description="settings?.hasApiKey ? 'Leave empty to keep the stored key, clear and save to remove it' : 'Required for Anthropic; optional for local OpenAI-compatible servers'"
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
              :description="provider === 'anthropic' ? 'Default: claude-opus-4-8' : 'Required, e.g. llama3.1, gpt-4o, mistral'"
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
              :description="provider === 'openai' ? 'Required, e.g. http://localhost:11434/v1' : 'Optional proxy override'"
            >
              <UInput
                v-model="baseUrl"
                :placeholder="provider === 'openai' ? 'http://localhost:11434/v1' : 'https://api.anthropic.com (default)'"
                :disabled="settings?.envManaged"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Auto-diagnose">
              <div class="flex items-center gap-3">
                <USwitch
                  v-model="autoDiagnose"
                  :disabled="settings?.envManaged"
                />
                <span class="text-sm text-gray-500">Automatically diagnose new failure clusters when a run finishes — one LLM call per new cluster, max 3 per run</span>
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
              :disabled="!provider || settings?.envManaged"
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
          <h3 class="font-semibold">
            Privacy notice
          </h3>
        </template>
        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p>When diagnosing a failure cluster, the following data is sent to the configured LLM provider:</p>
          <ul class="list-disc list-inside space-y-1 ml-2">
            <li>Normalized error signature and sample raw error text</li>
            <li>Test titles and file paths for affected tests</li>
            <li>Browser info, test steps, console error/warning entries (excerpts)</li>
            <li>Failed network request URLs and status codes</li>
            <li>ARIA page snapshot (if collected)</li>
            <li>Commit SHA range since last passing run (no code content)</li>
          </ul>
          <p class="mt-2">
            The API key is stored plaintext in the application database (admin-only access).
            For stricter setups, use <code class="font-mono text-xs">NUXT_AI_API_KEY</code> instead of the UI.
          </p>
        </div>
      </UCard>
    </div>
  </UDashboardPanel>
</template>
