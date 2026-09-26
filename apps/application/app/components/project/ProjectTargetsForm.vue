<script setup lang="ts">
/**
 * The project's targets: a goal per catalog metric, each optional. The
 * analytics tiles, the portfolio, the insights and the quality report say
 * whether each one is met over the period they show.
 */
import { TARGET_DEFS, readProjectTargets, type ProjectTargets, type TargetKey } from '#shared/analytics/targets';

const props = defineProps<{ projectId: number; targets: unknown }>();
const emit = defineEmits<{ saved: [] }>();

const toast = useToast();
const saving = ref(false);
const state = ref<Record<TargetKey, string>>(emptyState());

function emptyState(): Record<TargetKey, string> {
  return Object.fromEntries(TARGET_DEFS.map((d) => [d.key, ''])) as Record<TargetKey, string>;
}

watch(
  () => props.targets,
  (raw) => {
    const stored = readProjectTargets(raw);
    const next = emptyState();
    for (const def of TARGET_DEFS) if (stored[def.key] !== undefined) next[def.key] = String(stored[def.key]);
    state.value = next;
  },
  { immediate: true },
);

const invalid = computed(() =>
  TARGET_DEFS.filter((d) => {
    const raw = state.value[d.key].trim();
    if (raw === '') return false;
    const n = Number(raw);
    return !Number.isFinite(n) || n < 0 || n > d.max;
  }).map((d) => d.key),
);

async function save() {
  if (invalid.value.length > 0) return;
  const targets: ProjectTargets = {};
  for (const def of TARGET_DEFS) {
    const raw = state.value[def.key].trim();
    if (raw !== '') targets[def.key] = Number(raw);
  }
  saving.value = true;
  try {
    await $fetch<unknown>(`/api/projects/${props.projectId}`, { method: 'PATCH', body: { targets } });
    toast.add({ title: 'Targets saved', color: 'success' });
    emit('saved');
  } catch (error) {
    toast.add({ title: 'Couldn’t save the targets', description: errorMessage(error), color: 'error' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SectionCard
    icon="i-lucide-target"
    title="Targets"
    subtitle="Goals the analytics and quality reports check this project against"
    help="project.targets"
    data-shot="project-targets"
  >
    <UForm :state="state" class="space-y-4" @submit="save">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          v-for="def in TARGET_DEFS"
          :key="def.key"
          :label="def.label"
          :name="def.key"
          :error="invalid.includes(def.key) ? `A number from 0 to ${def.max}` : undefined"
        >
          <UInput
            v-model="state[def.key]"
            inputmode="decimal"
            placeholder="No target"
            class="w-full"
            :data-testid="`target-${def.key}`"
          >
            <template #trailing>
              <span class="text-xs text-muted">{{ def.suffix }}</span>
            </template>
          </UInput>
        </UFormField>
      </div>
      <div class="flex justify-end">
        <UButton type="submit" icon="i-lucide-check" :loading="saving" :disabled="invalid.length > 0">
          Save targets
        </UButton>
      </div>
    </UForm>
  </SectionCard>
</template>
