<script setup lang="ts">
import { DIAGNOSIS_SECTIONS } from '#shared/diagnosis-sections';

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
  /** Section id to scroll to and briefly highlight when the modal opens. */
  focusSection?: string | null;
  /** Section ids the diagnosis cited — marked in the coverage map. */
  citedSections?: string[];
}>();

type CoverageState = 'present' | 'truncated' | 'absent';

const presentById = computed(() => {
  const m = new Map<string, ContextSection>();
  for (const s of props.sections) if (!m.has(s.id)) m.set(s.id, s);
  return m;
});

const citedSet = computed(() => new Set(props.citedSections ?? []));

/** Present/truncated/absent (+cited) state for every known section. */
const coverage = computed(() =>
  DIAGNOSIS_SECTIONS.map((meta) => {
    const s = presentById.value.get(meta.id);
    const state: CoverageState = !s ? 'absent' : s.truncated ? 'truncated' : 'present';
    return { id: meta.id, short: meta.short, label: meta.label, state, cited: citedSet.value.has(meta.id) };
  }),
);

const coverageCounts = computed(() => {
  const c = { present: 0, truncated: 0, absent: 0 };
  for (const s of coverage.value) c[s.state]++;
  return c;
});

const dotClass: Record<CoverageState, string> = {
  present: 'bg-emerald-500',
  truncated: 'bg-amber-500',
  absent: 'bg-gray-300 dark:bg-gray-600',
};

function coverageTitle(c: { label: string; state: CoverageState; cited: boolean }): string {
  return `${c.label}: ${c.state}${c.cited ? ' · cited by the diagnosis' : ''}`;
}

const emit = defineEmits<{
  'update:open': [value: boolean];
  refresh: [];
}>();

const { copy, copied } = useCopy();

const sectionsByCategory = computed(() => {
  const categories: { label: string; items: ContextSection[] }[] = [];
  const primary = ['clusterSummary', 'sampleError', 'representativeExecution', 'executionError', 'runContext'];
  const evidence = [
    'testAnnotations',
    'testSource',
    'steps',
    'failingSteps',
    'console',
    'networkRequests',
    'serverLogs',
    'webVitals',
    'ariaSnapshot',
  ];
  const analysis = [
    'recurrenceFlakiness',
    'baselineComparison',
    'retryProgression',
    'passedPeers',
    'browserDistribution',
    'affectedTests',
  ];
  const scm = ['scmInvestigation', 'selectedCommits'];
  const other = ['priorDiagnosis', 'tracePointers', 'artifacts'];

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

// Scroll to and briefly highlight a section when opened via an evidence citation.
const highlightedId = ref<string | null>(null);
watch(
  () => [props.open, props.focusSection] as const,
  async ([open, focus]) => {
    if (!open || !focus) return;
    await nextTick();
    const el = document.querySelector(`[data-section-id="${focus}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlightedId.value = focus;
    setTimeout(() => {
      if (highlightedId.value === focus) highlightedId.value = null;
    }, 2500);
  },
);

function sectionHeading(s: ContextSection): string {
  let h = `## ${s.title}`;
  const meta: string[] = [];
  meta.push(`${s.chars} chars`);
  if (s.truncated) meta.push('truncated');
  if (s.items != null) meta.push(`${s.items} items`);
  if (meta.length) h += ` — ${meta.join(', ')}`;
  return h;
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

      <!-- Data coverage map -->
      <div class="rounded-lg border border-default bg-elevated/30 p-3 mb-4">
        <div class="flex items-center justify-between gap-2 mb-2">
          <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Data coverage</p>
          <p class="text-xs text-gray-400">
            {{ coverageCounts.present }} present · {{ coverageCounts.truncated }} truncated ·
            {{ coverageCounts.absent }} absent
          </p>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="c in coverage"
            :key="c.id"
            class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
            :class="[
              c.cited ? 'border-primary text-primary' : 'border-default',
              c.state === 'absent' ? 'text-gray-400 opacity-70' : '',
            ]"
            :title="coverageTitle(c)"
          >
            <span class="size-1.5 rounded-full shrink-0" :class="dotClass[c.state]" />
            {{ c.short }}
            <UIcon v-if="c.cited" name="i-lucide-quote" class="size-2.5 shrink-0" />
          </span>
        </div>
        <p class="text-xs text-gray-400 mt-2">
          Absent or truncated evidence lowers the diagnosis confidence.
          <UIcon name="i-lucide-quote" class="size-2.5 inline" /> marks sections the diagnosis cited.
        </p>
      </div>

      <div class="space-y-4">
        <div v-for="cat in sectionsByCategory" :key="cat.label">
          <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{{ cat.label }}</p>
          <div class="space-y-2">
            <div
              v-for="s in cat.items"
              :key="s.id"
              :data-section-id="s.id"
              class="relative rounded-lg transition-shadow"
              :class="
                highlightedId === s.id ? 'ring-2 ring-primary' : citedSet.has(s.id) ? 'ring-1 ring-primary/40' : ''
              "
            >
              <MarkdownPreview :text="sectionHeading(s) + '\n\n' + s.markdown" />
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                size="xs"
                color="neutral"
                variant="ghost"
                class="absolute top-1 right-1"
                @click="copy(s.markdown)"
              />
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
