<script setup lang="ts">
/**
 * Cluster-level locator healing panel. Fetches locator alternatives for the
 * representative failing locator in the cluster. Shown in the cluster detail
 * evidence section (left column).
 */

const props = defineProps<{
  runId: number;
  testRunsCaseId: number;
}>();

interface RankedLocator {
  locator: string;
  method: string;
  args: Record<string, unknown>;
  score: number;
}

interface LocatorHealingResult {
  failingLocator: { method: string; args: Record<string, unknown> } | null;
  fromPriorSuccess: RankedLocator[] | null;
  fromAriaSnapshot: RankedLocator[] | null;
  source: 'prior-run' | 'fingerprint' | 'aria-snapshot' | 'none';
}

const {
  data: healing,
  pending,
  error,
} = useFetch<LocatorHealingResult>(
  () => `/api/test-runs/${props.runId}/cases/${props.testRunsCaseId}/locator-healing`,
  { lazy: true },
);

const hasData = computed(
  () =>
    healing.value &&
    healing.value.source !== 'none' &&
    (healing.value.fromPriorSuccess?.length || healing.value.fromAriaSnapshot?.length),
);

const alternatives = computed(() => {
  if (!healing.value) return [];
  return healing.value.fromPriorSuccess ?? healing.value.fromAriaSnapshot ?? [];
});

const sourceNote = computed(() => {
  switch (healing.value?.source) {
    case 'prior-run':
      return 'Pre-captured from the last passing run — highest confidence';
    case 'fingerprint':
      return 'Matched by locator fingerprint (line numbers shifted)';
    case 'aria-snapshot':
      return 'Generated from failure-time ARIA snapshot — limited, no HTML attributes';
    default:
      return '';
  }
});

const { copy, copied } = useCopy();

function scoreColor(score: number): 'success' | 'warning' | 'error' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}

function locatorNote(method: string, score: number): string {
  if (score >= 100) return 'most stable — purpose-built for testing';
  if (method === 'getByRole') return 'browser ARIA tree — semantic and stable';
  if (method === 'getByLabel') return 'associated <label> element';
  if (method === 'getByPlaceholder') return 'input placeholder';
  if (method === 'getByText') return 'visible text';
  if (method === 'getByAltText') return 'image alt text';
  if (method === 'getByTitle') return 'title attribute';
  if (method === 'locator' && score >= 50) return 'stable selector';
  if (method === 'locator') return 'CSS class — may be fragile';
  return '';
}

function scoreBgClass(score: number): string {
  if (score >= 80) return 'bg-success/10';
  if (score >= 50) return 'bg-warning/10';
  return 'bg-error/10';
}
</script>

<template>
  <SectionCard
    v-if="!pending && !error && hasData"
    icon="i-lucide-bandage"
    title="Alternative locators"
    :count="alternatives.length"
    help="locator-healing"
  >
    <template #subtitle>
      <span
        v-if="healing?.source === 'prior-run' || healing?.source === 'fingerprint'"
        class="text-success-600 dark:text-success-400"
      >
        {{ sourceNote }}
      </span>
      <span v-else class="text-warning-600 dark:text-warning-400">
        {{ sourceNote }}
      </span>
    </template>

    <!-- Failing locator -->
    <div
      v-if="healing?.failingLocator"
      class="flex items-center gap-2 bg-elevated rounded p-2 mb-3 border border-red-200 dark:border-red-800"
    >
      <UIcon name="i-lucide-x-circle" class="size-4 text-red-500 shrink-0" />
      <code class="text-xs font-mono text-red-600 dark:text-red-400 flex-1 truncate">
        {{ healing.failingLocator.method }}({{ JSON.stringify(healing.failingLocator.args) }})
      </code>
    </div>

    <!-- Ranked alternatives -->
    <div class="space-y-2">
      <div
        v-for="(alt, i) in alternatives"
        :key="i"
        class="flex items-center gap-3 rounded-lg p-3 border border-default"
        :class="scoreBgClass(alt.score)"
      >
        <UBadge size="sm" :color="scoreColor(alt.score)" variant="subtle" class="shrink-0 w-12 text-center font-mono">
          {{ alt.score }}/100
        </UBadge>
        <div class="flex-1 min-w-0">
          <code class="text-sm font-mono block truncate">{{ alt.locator }}</code>
          <p class="text-xs text-gray-500 mt-0.5">{{ locatorNote(alt.method, alt.score) }}</p>
        </div>
        <UButton
          size="xs"
          variant="outline"
          color="neutral"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          :title="copied ? 'Copied!' : 'Copy'"
          @click="copy(alt.locator, { toast: 'Locator copied' })"
        />
      </div>
    </div>

    <!-- Top recommendation highlight -->
    <div
      v-if="alternatives.length > 0"
      class="rounded-lg border border-primary/40 bg-primary/5 p-3 mt-3 flex items-center gap-3"
    >
      <UIcon name="i-lucide-star" class="size-5 text-primary shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium text-primary">Top recommendation (score: {{ alternatives[0]!.score }})</p>
        <code class="text-sm font-mono block truncate mt-0.5">{{ alternatives[0]!.locator }}</code>
      </div>
      <UButton
        size="sm"
        color="primary"
        variant="solid"
        trailing-icon="i-lucide-copy"
        @click="copy(alternatives[0]!.locator, { toast: 'Copied!' })"
      >
        Copy
      </UButton>
    </div>
  </SectionCard>

  <!-- No data -->
  <SectionCard
    v-else-if="!pending && !error && !hasData"
    icon="i-lucide-bandage"
    title="Alternative locators"
    subtitle="No alternatives available"
    help="locator-healing"
  >
    <UAlert
      color="neutral"
      icon="i-lucide-info"
      description="No pre-captured alternatives — enable Piwi dashboard fixtures to capture element attributes at test time. Alternatives will appear after the next passing run."
    />
  </SectionCard>
</template>
