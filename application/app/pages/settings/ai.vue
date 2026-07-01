<script setup lang="ts">
import type { AiSettings, AiModelRole, ModelInfo, AiRoleConfigInput, SaveAiSettingsBody } from '~~/types/api';
import type { RoleForm } from '~/components/settings/AiRoleConfigForm.vue';
import { CONTEXT_LIMIT_FIELDS } from '#shared/ai-context-limits';
import type { ContextLimits, ContextLimitField } from '#shared/ai-context-limits';
import { pageEnvVars, getSettingsPage } from '~/utils/settings-metadata';
import type { PiwiEnvVarName } from '#shared/piwi-env-vars';

const toast = useToast();

const { data: settings, refresh } = await useFetch<AiSettings>('/api/settings/ai');

// ── Per-role provider configuration ─────────────────────────────────────────
type RoleKey = AiModelRole;

function blankRole(): RoleForm {
  return { enabled: false, reuse: null, provider: '', model: '', baseUrl: '', apiKey: '' };
}

const roles = reactive<Record<RoleKey, RoleForm>>({
  diagnosis: blankRole(),
  research: blankRole(),
  embedding: blankRole(),
});

const autoDiagnose = ref(false);
const customInstructions = ref<string>('');
const scmToken = ref<string>('');
const saving = ref(false);
const savingInstructions = ref(false);
const savingScmToken = ref(false);

const testing = ref(false);

const modelsRecord = reactive<Record<RoleKey, ModelInfo[]>>({
  diagnosis: [],
  research: [],
  embedding: [],
});
const loadingModels = reactive<Record<RoleKey, boolean>>({
  diagnosis: false,
  research: false,
  embedding: false,
});

function resolvedProvider(role: RoleKey): string {
  const r = roles[role];
  if (r.reuse) return roles[r.reuse]?.provider || '';
  return r.provider;
}

async function loadModels(role: RoleKey) {
  const r = roles[role];
  const provider = resolvedProvider(role);
  const source = r.reuse ? roles[r.reuse] : r;
  const apiKey = source.apiKey || undefined;
  loadingModels[role] = true;
  try {
    const res = await $fetch<{ models: ModelInfo[] }>('/api/settings/ai/models', {
      method: 'POST',
      body: { provider, baseUrl: source.baseUrl || undefined, apiKey },
    });
    modelsRecord[role] = res.models;
  } catch {
    modelsRecord[role] = [];
  } finally {
    loadingModels[role] = false;
  }
}

const ROLE_META = [
  {
    key: 'diagnosis',
    title: 'Diagnosis model',
    icon: 'i-lucide-stethoscope',
    help: 'settings.ai-provider',
    optional: false,
    enableLabel: '',
    blurb: 'The main model that writes the final diagnosis. Required to enable AI features.',
    reuseTargets: [],
    modelPlaceholderAnthropic: 'claude-opus-4-8',
    modelPlaceholderOpenai: 'e.g. gpt-4o, llama3.1',
  },
  {
    key: 'research',
    title: 'Research model',
    icon: 'i-lucide-search',
    help: 'settings.ai-research',
    optional: true,
    enableLabel: 'Two-stage diagnosis',
    blurb: 'A cheaper/faster model that pre-analyzes the failure before the diagnosis model writes the final answer.',
    reuseTargets: ['diagnosis'],
    modelPlaceholderAnthropic: 'e.g. claude-haiku-4-5',
    modelPlaceholderOpenai: 'e.g. llama-3.1-8b-instant',
  },
  {
    key: 'embedding',
    title: 'Embedding model',
    icon: 'i-lucide-vector-square',
    help: 'settings.ai-provider',
    optional: true,
    enableLabel: 'Semantic clustering',
    blurb: 'Embeds failures so semantically-similar errors group together (used by failure clustering).',
    reuseTargets: ['diagnosis', 'research'],
    modelPlaceholderAnthropic: '— Anthropic has no embeddings API —',
    modelPlaceholderOpenai: 'e.g. text-embedding-3-small',
  },
] as const;

const providerOptions = [
  { label: 'Anthropic API', value: 'anthropic' },
  { label: 'OpenAI-compatible', value: 'openai' },
];

// Stable per-role reuse options (recomputed only when role-enable state changes),
// so the child <USelect>'s `items` keep a stable reference and the listbox doesn't
// reset on every parent render. 'own' is the sentinel for "configure own provider".
const reuseOptionsByRole = computed<Record<RoleKey, Array<{ label: string; value: string }>>>(() => {
  const out = {} as Record<RoleKey, Array<{ label: string; value: string }>>;
  for (const meta of ROLE_META) {
    out[meta.key] = [
      { label: 'Configure its own provider', value: 'own' },
      ...meta.reuseTargets
        .filter((t) => roles[t].enabled || t === 'diagnosis')
        .map((t) => ({ label: `Reuse ${ROLE_META.find((m) => m.key === t)!.title.toLowerCase()}`, value: t })),
    ];
  }
  return out;
});

const envManaged = computed(() => Boolean(settings.value?.envManaged));
const aiEnvVars = pageEnvVars(getSettingsPage('ai'));

watch(
  settings,
  (val) => {
    if (!val) return;
    for (const meta of ROLE_META) {
      const r = val.roles[meta.key];
      const form = roles[meta.key];
      form.enabled = Boolean(r);
      form.reuse = r?.reuse ?? null;
      form.provider = r?.provider ?? '';
      form.model = r?.model ?? '';
      form.baseUrl = r?.baseUrl ?? '';
      form.apiKey = '';
    }
    autoDiagnose.value = val.autoDiagnose;
    customInstructions.value = val.customInstructions || '';
  },
  { immediate: true },
);

function hasStoredKey(role: RoleKey): boolean {
  return Boolean(settings.value?.roles[role]?.hasApiKey);
}

// ── OpenAI presets ──────────────────────────────────────────────────────────
interface OpenAiPreset {
  label: string;
  baseUrl: string;
  model: string;
}

const OPENAI_PRESETS: OpenAiPreset[] = [
  { label: 'ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: '' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.1-8b-instruct' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { label: 'Custom', baseUrl: '', model: '' },
];
const presetOptions = OPENAI_PRESETS.map((p) => ({ label: p.label, value: p.label }));

function applyPreset(role: RoleKey, label: string) {
  const preset = OPENAI_PRESETS.find((p) => p.label === label);
  if (!preset || preset.label === 'Custom') return;
  roles[role].baseUrl = preset.baseUrl;
  roles[role].model = preset.model;
}

// ── Save ─────────────────────────────────────────────────────────────────────
function roleBody(role: RoleKey): AiRoleConfigInput | null {
  const r = roles[role];
  if (!r.enabled) return null;
  if (r.reuse) return { reuse: r.reuse, model: r.model || undefined };
  const body: AiRoleConfigInput = {
    provider: r.provider,
    model: r.model || undefined,
    baseUrl: r.baseUrl || undefined,
  };
  if (r.apiKey !== '') body.apiKey = r.apiKey;
  return body;
}

async function save() {
  saving.value = true;
  try {
    // When env-managed, never send roles: null (would clear overrides).
    // When diagnosis is disabled or missing provider in non-env mode, clear the config.
    if (!envManaged && (!roles.diagnosis.enabled || !roles.diagnosis.provider)) {
      await $fetch('/api/settings/ai', { method: 'PUT', body: { roles: null, autoDiagnose: autoDiagnose.value } });
    } else {
      await $fetch('/api/settings/ai', {
        method: 'PUT',
        body: {
          roles: {
            diagnosis: roleBody('diagnosis'),
            research: roleBody('research'),
            embedding: roleBody('embedding'),
          },
          autoDiagnose: autoDiagnose.value,
        },
      });
    }
    await refresh();
    for (const meta of ROLE_META) roles[meta.key].apiKey = '';
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
    await $fetch('/api/settings/ai', { method: 'PUT', body: { scmToken: scmToken.value || null } });
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
    await $fetch('/api/settings/ai', { method: 'PUT', body: { customInstructions: customInstructions.value || null } });
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
    const d = roles.diagnosis;
    const res = await $fetch<{ success: boolean; model?: string; error?: string }>('/api/settings/ai/test', {
      method: 'POST',
      body: {
        provider: d.provider,
        apiKey: d.apiKey || undefined,
        model: d.model || undefined,
        baseUrl: d.baseUrl || undefined,
      },
    });
    if (res.success)
      toast.add({ title: 'Connection successful', description: `Model: ${res.model}`, color: 'success' });
    else toast.add({ title: 'Connection failed', description: res.error || 'Unknown error', color: 'error' });
  } catch (err) {
    toast.add({ title: 'Connection failed', description: String((err as Error)?.message ?? err), color: 'error' });
  } finally {
    testing.value = false;
  }
}

// ── Diagnosis context limits (unchanged) ─────────────────────────────────────
interface ContextLimitsResponse {
  limits: ContextLimits;
  defaults: ContextLimits;
  envManaged: (keyof ContextLimits)[];
  fields: ContextLimitField[];
}

const { data: limitsData } = await useFetch<ContextLimitsResponse>('/api/settings/ai/limits');
const limitFields = CONTEXT_LIMIT_FIELDS;
const limitValues = reactive<Record<string, number | undefined>>({});
const savingLimits = ref(false);
const envManagedLimits = computed(() => new Set<string>(limitsData.value?.envManaged ?? []));

watch(
  limitsData,
  (val) => {
    if (!val) return;
    for (const f of limitFields) limitValues[f.key] = val.limits[f.key];
  },
  { immediate: true },
);

async function saveLimits() {
  savingLimits.value = true;
  try {
    limitsData.value = await $fetch<ContextLimitsResponse>('/api/settings/ai/limits', {
      method: 'PUT',
      body: { limits: limitValues },
    });
    toast.add({ title: 'Context limits saved', color: 'success' });
  } catch (e) {
    toast.add({
      title: 'Failed to save context limits',
      description: String((e as Error)?.message ?? e),
      color: 'error',
    });
  } finally {
    savingLimits.value = false;
  }
}

function resetLimits() {
  if (!limitsData.value) return;
  for (const f of limitFields) {
    if (envManagedLimits.value.has(f.key)) continue;
    limitValues[f.key] = limitsData.value.defaults[f.key];
  }
}
</script>

<template>
  <div class="space-y-6">
    <EnvManagedAlert v-if="envManaged" :env-vars="aiEnvVars" />

    <SectionCard icon="i-lucide-sparkles" title="Model providers" help="settings.ai-provider">
      <template #subtitle>
        Configure a complete provider for each model role. Optional roles can reuse another role's provider so you don't
        re-enter credentials.
      </template>

      <div class="space-y-5">
        <AiRoleConfigForm
          v-for="meta in ROLE_META"
          :key="meta.key"
          v-model="roles[meta.key]"
          :meta="meta"
          :has-api-key="hasStoredKey(meta.key)"
          :reuse-options="reuseOptionsByRole[meta.key]"
          :provider-options="providerOptions"
          :preset-options="presetOptions"
          :disabled="envManaged"
          :env-managed="envManaged"
          :provider-resolved="resolvedProvider(meta.key)"
          :models="modelsRecord[meta.key]"
          :loading-models="loadingModels[meta.key]"
          @apply-preset="(label: string) => applyPreset(meta.key, label)"
          @load-models="loadModels(meta.key)"
        />

        <SettingsField label="Auto-diagnose" help="settings.auto-diagnose" :env-managed="envManaged">
          <div class="flex items-center gap-3">
            <USwitch v-model="autoDiagnose" :disabled="envManaged || !roles.diagnosis.enabled" />
            <span class="text-sm text-gray-500">
              Automatically diagnose new failure clusters when a run finishes — one LLM call per new cluster, max 3 per
              run
            </span>
          </div>
        </SettingsField>
      </div>

      <template #footer>
        <div class="flex items-center gap-2 justify-end">
          <UButton
            color="neutral"
            variant="soft"
            :loading="testing"
            :disabled="!roles.diagnosis.provider"
            icon="i-lucide-plug"
            @click="testConnection"
          >
            Test diagnosis connection
          </UButton>
          <UButton color="primary" :loading="saving" icon="i-lucide-save" @click="save"> Save </UButton>
        </div>
      </template>
    </SectionCard>

    <SectionCard title="Repository access" help="project.scm-token">
      <template #subtitle> Optional — required for private repositories. Per-project tokens override this. </template>

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
    </SectionCard>

    <SectionCard title="Global analysis instructions" help="settings.ai-instructions">
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
    </SectionCard>

    <SectionCard title="Diagnosis context limits" help="settings.ai-limits">
      <template #subtitle> Leave a field empty to use its default; env-managed fields are read-only. </template>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <UFormField
          v-for="f in limitFields"
          :key="f.key"
          :label="f.label"
          :description="f.description"
          :hint="`default ${limitsData?.defaults[f.key] ?? ''}`"
        >
          <UInput
            v-model.number="limitValues[f.key]"
            type="number"
            :min="f.min"
            :max="f.max"
            :disabled="envManagedLimits.has(f.key)"
            :placeholder="`default ${limitsData?.defaults[f.key] ?? ''}`"
            class="w-full"
          >
            <template v-if="envManagedLimits.has(f.key)" #trailing>
              <EnvManagedBadge :env-vars="[f.envVar as PiwiEnvVarName]" />
            </template>
          </UInput>
        </UFormField>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" @click="resetLimits">Reset to defaults</UButton>
          <UButton color="primary" :loading="savingLimits" icon="i-lucide-save" size="sm" @click="saveLimits">
            Save limits
          </UButton>
        </div>
      </template>
    </SectionCard>

    <SectionCard icon="i-lucide-shield-check" title="Privacy notice" help="settings.privacy">
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
          API keys are stored encrypted in the application database (admin-only access). For stricter setups, use the
          <code class="font-mono text-xs">PIWI_AI_*</code> environment variables instead of the UI.
        </p>
      </div>
    </SectionCard>
  </div>
</template>
