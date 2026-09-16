<script setup lang="ts">
import type { FlakyTest } from '~~/types/api';
import { buildTestRowBadges } from '~/utils/test-row-badges';

const props = defineProps<{
  projectId: string | number;
  environment?: string | null;
  branch?: string | null;
  /** Piwi project name, threaded so the IDE opener can default the JetBrains project. */
  projectName?: string | null;
}>();

const emit = defineEmits<{ count: [total: number]; quarantined: [] }>();

const toast = useToast();
const { canWrite } = useAuth();
const quarantiningId = ref<number | null>(null);

const runsWindow = ref(50);
const rootCauseFilter = ref<string[]>([]);

const { data: tests, pending: loading } = await useFetch(
  () => {
    const params = new URLSearchParams({ runs: String(runsWindow.value) });
    if (props.environment) params.set('environment', props.environment);
    if (props.branch) params.set('branch', props.branch);
    return `/api/projects/${props.projectId}/flaky-tests?${params.toString()}`;
  },
  {
    lazy: true,
    server: false,
    watch: [runsWindow, () => props.environment, () => props.branch],
    transform: (r: { items: FlakyTest[] }) => r.items,
  },
);

const filteredTests = computed(() => {
  if (rootCauseFilter.value.length === 0) return tests.value ?? [];
  return (tests.value ?? []).filter((t) => rootCauseFilter.value.includes(t.rootCause ?? ''));
});

watch(tests, (list) => emit('count', list?.length ?? 0));

async function quarantineTest(test: FlakyTest) {
  quarantiningId.value = test.testCaseId;
  try {
    await $fetch(`/api/projects/${props.projectId}/quarantine`, {
      method: 'POST',
      body: { testCaseId: test.testCaseId, reason: 'Flaky', source: 'manual' },
    });
    toast.add({ title: 'Test quarantined', description: test.title, color: 'success' });
    emit('quarantined');
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Quarantine failed', description: message || 'An error occurred', color: 'error' });
  } finally {
    quarantiningId.value = null;
  }
}

function scoreColor(score: number): 'error' | 'warning' | 'neutral' {
  if (score >= 60) return 'error';
  if (score >= 30) return 'warning';
  return 'neutral';
}

function rootCauseColor(cause: string | null): string {
  switch (cause) {
    case 'timing':
      return 'amber';
    case 'network':
      return 'red';
    case 'assertion':
      return 'blue';
    case 'environment':
      return 'purple';
    default:
      return 'gray';
  }
}

function toggleRootCauseFilter(cause: string) {
  const idx = rootCauseFilter.value.indexOf(cause);
  if (idx >= 0) {
    rootCauseFilter.value = rootCauseFilter.value.filter((c) => c !== cause);
  } else {
    rootCauseFilter.value = [...rootCauseFilter.value, cause];
  }
}

const ROOT_CAUSE_OPTIONS = [
  { label: 'Timing', value: 'timing' },
  { label: 'Network', value: 'network' },
  { label: 'Assertion', value: 'assertion' },
  { label: 'Environment', value: 'environment' },
  { label: 'Other', value: 'other' },
];

function impactDotClass(wastedCiMinutes: number): string {
  if (wastedCiMinutes >= 30) return 'bg-red-500';
  if (wastedCiMinutes >= 5) return 'bg-amber-500';
  return 'bg-green-500';
}

/** Tags and ownership metadata rendered as the row's badges. */
function flakyBadges(test: FlakyTest) {
  return buildTestRowBadges({
    tags: test.tags,
    meta: { owner: test.owner ?? undefined, priority: toTestPriority(test.priority) },
  });
}
</script>

<template>
  <UCard data-shot="flaky-table">
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <p class="text-sm text-gray-500 inline-flex items-center gap-1">
            Tests that fail intermittently — detected by retry passes and status alternations
            <HelpHint topic="project.flaky-tests" />
          </p>
          <EnvironmentBadge v-if="environment" :name="environment" class="text-xs" />
          <div class="flex items-center gap-1.5">
            <UButton
              v-for="opt in ROOT_CAUSE_OPTIONS"
              :key="opt.value"
              size="xs"
              :variant="rootCauseFilter.includes(opt.value) ? 'solid' : 'outline'"
              :color="rootCauseFilter.includes(opt.value) ? 'neutral' : 'neutral'"
              @click="toggleRootCauseFilter(opt.value)"
            >
              {{ opt.label }}
            </UButton>
          </div>
        </div>
        <USelect
          v-model="runsWindow"
          :items="[
            { label: 'Last 20 runs', value: 20 },
            { label: 'Last 50 runs', value: 50 },
            { label: 'Last 100 runs', value: 100 },
          ]"
          size="xs"
          class="w-36"
        />
      </div>
    </template>

    <LoadingState v-if="loading && filteredTests.length === 0" text="Loading flaky tests…" />

    <div v-else-if="filteredTests.length" class="rounded-lg border border-default overflow-hidden">
      <TestRow
        v-for="test in filteredTests"
        :key="test.testCaseId"
        :href="`/test-cases/${test.testCaseId}`"
        :title="test.title"
        status="flaky"
        icon="i-lucide-shuffle"
        icon-class="text-amber-600 dark:text-amber-400"
        :file-path="test.filePath"
        :badges="flakyBadges(test)"
        :project-key="projectId"
        :project-name="projectName"
      >
        <template #metrics>
          <span
            class="inline-flex items-center gap-1 tabular-nums"
            :title="`${Math.round(test.wastedCiMinutes)} CI minutes wasted`"
          >
            <span class="inline-block size-2 rounded-full shrink-0" :class="impactDotClass(test.wastedCiMinutes)" />
            {{ Math.round(test.wastedCiMinutes) }} min
          </span>
          <UBadge :color="scoreColor(test.score)" variant="subtle" size="xs" title="Flaky score">
            {{ test.score }}
          </UBadge>
          <span class="tabular-nums" title="Failure rate">{{ Math.round(test.failureRate * 100) }}% fail</span>
          <UButton
            v-if="canWrite"
            size="xs"
            variant="outline"
            color="warning"
            icon="i-lucide-shield-alert"
            :loading="quarantiningId === test.testCaseId"
            @click="quarantineTest(test)"
          >
            Quarantine
          </UButton>
        </template>

        <template #subline>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <TagBadge v-if="test.rootCause" :text="test.rootCause" :color="rootCauseColor(test.rootCause)" />
            <span v-if="test.retryPassRuns" class="tabular-nums">
              {{ test.retryPassRuns }} retry pass{{ test.retryPassRuns === 1 ? '' : 'es' }}
            </span>
            <span v-if="test.alternations >= 2" class="tabular-nums">{{ test.alternations }} flips</span>
            <span v-if="test.lastFlakeAt">Last flake {{ formatRelativeTime(test.lastFlakeAt) }}</span>
          </div>
        </template>
      </TestRow>
    </div>

    <p v-if="!loading && filteredTests.length === 0" class="text-sm text-gray-500 py-4 text-center">
      No flaky tests detected in the last {{ runsWindow }} runs.
    </p>
  </UCard>
</template>
