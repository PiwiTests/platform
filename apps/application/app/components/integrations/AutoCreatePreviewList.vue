<script setup lang="ts">
/**
 * What the automatic-creation rules being edited do with the project's open
 * failures that no issue tracks, run on demand against the unsaved form;
 * nothing is written. Lists the failures a rule files at their next occurrence
 * in a run it counts, those waiting on a threshold and those left out, each
 * with the reason, and warns when the tracker requires a field the binding
 * leaves empty.
 */
import type { AutoCreatePreview, AutoCreatePreviewItem } from '#shared/handlers/tracker-automation';
import type { ResolvedProjectIntegration } from '#shared/integrations/binding';

const props = defineProps<{
  projectId: number;
  /** The binding as the form holds it now. */
  binding: Partial<ResolvedProjectIntegration>;
}>();

const preview = ref<AutoCreatePreview | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function run() {
  loading.value = true;
  error.value = null;
  try {
    preview.value = await $fetch<AutoCreatePreview>(
      `/api/projects/${props.projectId}/integrations/auto-create-preview`,
      { method: 'POST', body: props.binding },
    );
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

const GROUPS: Array<{ verdict: AutoCreatePreviewItem['decision']['verdict']; title: string }> = [
  { verdict: 'file', title: 'Filed at their next occurrence in a run a rule counts' },
  { verdict: 'wait', title: 'Waiting on a threshold' },
  { verdict: 'skip', title: 'Left out' },
];

const groups = computed(() =>
  GROUPS.map((group) => ({
    ...group,
    items: (preview.value?.items ?? []).filter((item) => item.decision.verdict === group.verdict),
  })).filter((group) => group.items.length > 0),
);

const missingFieldsText = computed(() => {
  const names = preview.value?.missingFields ?? [];
  if (names.length === 0) return null;
  return `The tracker requires ${names.join(', ')}, and the binding gives no value: an automatic create would be refused.`;
});
</script>

<template>
  <div class="space-y-2" data-shot="auto-create-preview">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        label="Preview"
        icon="i-lucide-list-checks"
        size="xs"
        color="neutral"
        variant="outline"
        :loading="loading"
        @click="run"
      />
      <span class="text-xs text-muted">Which open failures these rules file. Nothing is written.</span>
    </div>
    <ErrorText v-if="error" :text="error" class="text-sm" />
    <template v-if="preview">
      <p class="text-xs text-muted">
        {{ preview.filedLastDay }} of {{ preview.dailyCap }} issues filed automatically in the last 24 hours.
      </p>
      <CheckResultLine
        v-if="missingFieldsText"
        state="warning"
        :text="missingFieldsText"
        hint="Set a value under Jira fields above."
      />
      <p v-if="preview.items.length === 0" class="text-sm text-muted">Every open failure already has an issue.</p>
      <div v-for="group in groups" :key="group.verdict">
        <p class="text-sm font-semibold text-highlighted mt-3 mb-1">{{ group.title }} ({{ group.items.length }})</p>
        <ul class="space-y-1.5">
          <li v-for="item in group.items" :key="item.clusterId" class="min-w-0">
            <ULink :to="`/failure-clusters/${item.clusterId}`" class="block truncate text-sm text-primary">
              {{ item.title }}
            </ULink>
            <span class="block text-xs text-muted">{{ item.description }}</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
