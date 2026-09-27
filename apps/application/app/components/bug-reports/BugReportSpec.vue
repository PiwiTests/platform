<script setup lang="ts">
/**
 * The report's failing test, rendered on the server with the project's
 * generated-spec settings: the spec to commit (`test.fail()`, `piwi:bug`) or
 * the one a reproduction runs.
 */
const props = defineProps<{ reportId: number; projectId: number }>();

interface SpecAnswer {
  mode: 'commit' | 'run';
  code: string;
  fileName: string;
  path: string;
  warnings: Array<{ step: number; message: string }>;
}

const mode = ref<'commit' | 'run'>('commit');
const modeItems = [
  { label: 'To commit, marked test.fail()', value: 'commit' },
  { label: 'To run, expected to fail while the bug is there', value: 'run' },
];

const spec = ref<SpecAnswer | null>(null);
const failed = ref(false);
watch(
  mode,
  async (value) => {
    failed.value = false;
    try {
      spec.value = await $fetch<SpecAnswer>(`/api/bug-reports/${props.reportId}/spec`, { query: { mode: value } });
    } catch {
      failed.value = true;
    }
  },
  { immediate: true },
);

const { saveBlob } = useDesktopDownload();
function download() {
  if (!spec.value) return;
  void saveBlob(new Blob([spec.value.code], { type: 'text/plain' }), spec.value.fileName);
}
</script>

<template>
  <SectionCard title="The failing test" icon="i-lucide-file-code" help="bug-report.spec" data-shot="bug-report-spec">
    <template #subtitle>
      <template v-if="spec">
        Goes to <span class="font-mono">{{ spec.path }}</span
        >; the folder and the test import are in the project’s
        <NuxtLink :to="`/projects/${projectId}/edit`" :class="SENTENCE_LINK_CLASS">generated specs settings</NuxtLink>.
      </template>
    </template>
    <template #actions>
      <USelect v-model="mode" :items="modeItems" size="sm" class="w-full sm:w-80" aria-label="Which spec" />
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-download" :disabled="!spec" @click="download">
        Download
      </UButton>
    </template>
    <ErrorState v-if="failed" text="Could not render the spec." />
    <LoadingState v-else-if="!spec" text="Rendering the spec…" />
    <div v-else class="space-y-2">
      <ul v-if="spec.warnings.length" class="space-y-1 text-xs text-muted">
        <li v-for="w in spec.warnings" :key="`${w.step}-${w.message}`">Step {{ w.step + 1 }}: {{ w.message }}</li>
      </ul>
      <CodeBlock :code="spec.code" lang="typescript" />
    </div>
  </SectionCard>
</template>
