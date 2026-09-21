<script setup lang="ts">
/**
 * The project-level capability overrides on the project edit form. Each
 * project-level capability reads Instance default, Declined for this project or
 * Enabled for this project, and a change is saved on its own through
 * `PATCH /api/projects/:id/capabilities`. Administrators only.
 */
import { CAPABILITIES, type CapabilityId, type ProjectDecision } from '#shared/capabilities';

const props = defineProps<{
  projectId: number;
  /** The project's stored raw decisions, seeded from the project record. */
  initial?: Partial<Record<CapabilityId, ProjectDecision>> | null;
}>();

const { canDecide, decide } = useProjectCapabilities(props.projectId);
const toast = useToast();

/** Plain labels for the capabilities a project can override. */
const CAPABILITY_LABELS: Partial<Record<CapabilityId, string>> = {
  fixtures: 'Capture fixtures',
  'backend-logs': 'Backend logs',
  'locator-healing': 'Locator healing',
  'green-samples': 'Green page samples',
  scm: 'Source control',
  quarantine: 'Quarantine',
  markers: 'Timeline markers',
};

/** Every capability a project can override, with a plain label. */
const PROJECT_CAPABILITIES: { id: CapabilityId; label: string }[] = CAPABILITIES.filter((c) =>
  c.levels.includes('project'),
).map((c) => ({ id: c.id, label: CAPABILITY_LABELS[c.id] ?? c.id }));

type Choice = 'default' | 'enabled' | 'declined';
const OPTIONS: { label: string; value: Choice }[] = [
  { label: 'Instance default', value: 'default' },
  { label: 'Enabled for this project', value: 'enabled' },
  { label: 'Declined for this project', value: 'declined' },
];

const choice = reactive<Record<string, Choice>>({});
for (const cap of PROJECT_CAPABILITIES) choice[cap.id] = (props.initial?.[cap.id] as Choice | undefined) ?? 'default';

const busy = ref(false);
async function onChange(id: CapabilityId, value: Choice) {
  choice[id] = value;
  if (busy.value) return;
  busy.value = true;
  try {
    await decide(id, value === 'default' ? null : value);
    toast.add({ title: 'Capability updated', color: 'success' });
  } catch {
    toast.add({ title: 'Could not update the capability', color: 'error' });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <UFormField v-if="canDecide" name="capabilities">
    <template #label>
      <span class="inline-flex items-center gap-1">Capabilities <HelpHint topic="project.capabilities" /></span>
    </template>
    <template #description> Override the instance default for this project. </template>
    <div class="space-y-2">
      <div v-for="cap in PROJECT_CAPABILITIES" :key="cap.id" class="flex items-center justify-between gap-3">
        <span class="text-sm text-highlighted">{{ cap.label }}</span>
        <USelect
          :model-value="choice[cap.id]"
          :items="OPTIONS"
          value-key="value"
          size="sm"
          class="w-56 shrink-0"
          :disabled="busy"
          :aria-label="`${cap.label} for this project`"
          @update:model-value="onChange(cap.id, $event as Choice)"
        />
      </div>
    </div>
  </UFormField>
</template>
