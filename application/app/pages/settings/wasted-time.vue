<script setup lang="ts">
interface WastedSettings {
  patterns: string[];
  envManaged: boolean;
  isDefault: boolean;
  defaults: string[];
}

const toast = useToast();

const { data: settings, refresh } = await useFetch<WastedSettings>('/api/settings/wasted-waits');

// Edited as free text, one pattern per line.
const text = ref('');
const saving = ref(false);

watchEffect(() => {
  if (settings.value) text.value = settings.value.patterns.join('\n');
});

const envManaged = computed(() => settings.value?.envManaged ?? false);

function parseText(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function save() {
  saving.value = true;
  try {
    const updated = await $fetch<WastedSettings>('/api/settings/wasted-waits', {
      method: 'PUT',
      body: { patterns: parseText(text.value) },
    });
    settings.value = updated;
    toast.add({ title: 'Wasted-time patterns saved', color: 'success' });
    await refresh();
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Save failed', description: message || 'An error occurred', color: 'error' });
  } finally {
    saving.value = false;
  }
}

async function resetToDefaults() {
  saving.value = true;
  try {
    const updated = await $fetch<WastedSettings>('/api/settings/wasted-waits', {
      method: 'PUT',
      body: { patterns: null },
    });
    settings.value = updated;
    text.value = updated.patterns.join('\n');
    toast.add({ title: 'Reset to defaults', color: 'success' });
    await refresh();
  } catch {
    toast.add({ title: 'Reset failed', color: 'error' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <UPageCard variant="subtle">
      <template #header>
        <h2 class="font-semibold text-base inline-flex items-center gap-1">Wasted-time patterns</h2>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Define which wait steps count as <strong>wasted time</strong>. A wait is wasted when any pattern below
          matches its step title (e.g. <code>Wait for timeout*</code>) or its source location (e.g.
          <code>*node_modules*</code>). Patterns are case-insensitive and support <code>*</code> and <code>?</code>
          wildcards. Wasted time is recomputed when runs are viewed, so changes apply to existing runs immediately.
        </p>

        <UAlert
          v-if="envManaged"
          icon="i-lucide-lock"
          color="neutral"
          variant="subtle"
          title="Managed by environment variable"
          description="These patterns are set via PIWI_WASTED_WAIT_PATTERNS and cannot be edited here."
        />

        <UFormField label="Patterns" description="One glob pattern per line. An empty list means no wait is counted as wasted.">
          <UTextarea
            v-model="text"
            :rows="6"
            :disabled="envManaged"
            class="w-full font-mono"
            placeholder="Wait for timeout*&#10;*waitForTimeout*"
          />
        </UFormField>

        <p class="text-xs text-gray-400">
          Default:
          <code>{{ settings?.defaults.join(', ') }}</code>
          — counts explicit <code>waitForTimeout</code> sleeps only. Use <code>*</code> to count every wait.
        </p>

        <div v-if="!envManaged" class="flex items-center gap-2">
          <UButton :loading="saving" label="Save" @click="save" />
          <UButton variant="ghost" color="neutral" :disabled="saving" label="Reset to defaults" @click="resetToDefaults" />
        </div>
      </div>
    </UPageCard>
  </div>
</template>
