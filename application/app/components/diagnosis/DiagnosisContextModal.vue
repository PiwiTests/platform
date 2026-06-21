<script setup lang="ts">
interface ContextSection {
  id: string;
  title: string;
  chars: number;
  truncated: boolean;
  markdown: string;
  items?: number;
}

const props = defineProps<{
  open: boolean;
  sections: ContextSection[];
  tokenEstimate: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  refresh: [];
}>();

const { copy, copied } = useCopy();

const sectionsByCategory = computed(() => {
  const categories: { label: string; items: ContextSection[] }[] = [];
  const primary = ['clusterSummary', 'sampleError', 'representativeExecution', 'executionError'];
  const evidence = [
    'testSource',
    'steps',
    'failingSteps',
    'console',
    'networkRequests',
    'serverLogs',
    'webVitals',
    'ariaSnapshot',
  ];
  const analysis = ['recurrenceFlakiness', 'passedPeers', 'browserDistribution', 'affectedTests'];
  const scm = ['scmInvestigation', 'selectedCommits'];
  const other = ['priorDiagnosis', 'tracePointers'];

  const categorize = (ids: string[], label: string) => {
    const items = props.sections.filter((s) => ids.includes(s.id));
    if (items.length > 0) categories.push({ label, items });
  };

  categorize(primary, 'Primary');
  categorize(evidence, 'Test Evidence');
  categorize(analysis, 'Analysis');
  categorize(scm, 'SCM');
  categorize(other, 'Other');
  return categories;
});

function sectionCount(s: ContextSection): string {
  return s.items != null ? `${s.items} items` : '';
}
</script>

<template>
  <UModal
    :open="open"
    title="Context sent to AI"
    :ui="{ content: 'max-w-5xl' }"
    @update:open="(v) => emit('update:open', v)"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2">
          <span class="font-semibold">Context sent to AI</span>
          <span class="text-xs text-gray-400">~{{ tokenEstimate }} tokens</span>
        </div>
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-refresh-cw"
            size="xs"
            color="neutral"
            variant="ghost"
            :loading="loading"
            @click="emit('refresh')"
          />
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" @click="emit('update:open', false)" />
        </div>
      </div>
    </template>

    <template #body>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Full prompt that would be sent to the AI provider. Copy individual sections or the full context below.
      </p>

      <div class="space-y-4">
        <div v-for="cat in sectionsByCategory" :key="cat.label">
          <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{{ cat.label }}</p>
          <div class="space-y-2">
            <div v-for="s in cat.items" :key="s.id" class="rounded-lg border border-default bg-elevated/30">
              <div class="flex items-center justify-between px-3 py-2 border-b border-default">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-xs font-medium truncate">{{ s.title }}</span>
                  <span class="text-xs text-gray-400 shrink-0">{{ s.chars }} chars</span>
                  <UBadge v-if="s.truncated" color="warning" variant="subtle" size="xs">truncated</UBadge>
                  <span v-if="sectionCount(s)" class="text-xs text-gray-400 shrink-0">{{ sectionCount(s) }}</span>
                </div>
                <UButton
                  :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="copy(s.markdown)"
                />
              </div>
              <div class="px-3 py-2 max-h-48 overflow-y-auto">
                <MarkdownPreview
                  :text="
                    '```\n' +
                    s.markdown.slice(0, 2000) +
                    (s.markdown.length > 2000 ? '\n... [truncated in preview]' : '') +
                    '\n```'
                  "
                />
              </div>
            </div>
          </div>
        </div>

        <div v-if="sections.length === 0 && !loading" class="text-center text-gray-400 py-8 text-sm">
          No context sections available.
        </div>
      </div>
    </template>
  </UModal>
</template>
