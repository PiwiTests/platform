<script setup lang="ts">
/**
 * The Gaps tab: a project's scenario gaps and resilience findings, grouped by
 * feature and ranked, each with its class, exposure factors and evidence lines,
 * and the inbox verbs — accept (opens the draft), snooze, dismiss with a reason,
 * covered-by. A node can be opened in the feature-graph view. Self-contained:
 * fetches its own data with watch + $fetch so it fires only when the tab mounts.
 */
interface GapFactors {
  churn: number;
  age: number;
  escapeHistory: number;
  priority: number;
}
interface Gap {
  id: number;
  kind: 'gap' | 'finding';
  detector: string;
  class: string;
  subject: { kind: string; key: string };
  title: string;
  evidence: string[];
  factors: GapFactors | null;
  score: number | null;
  status: string;
  feature: string | null;
  testCaseId: number | null;
}

const props = defineProps<{ projectId: number }>();
const toast = useToast();

const gaps = ref<Gap[]>([]);
const loading = ref(false);
const recomputing = ref(false);
const graphSeed = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await $fetch<{ items: Gap[] }>(`/api/projects/${props.projectId}/gaps` as `/api/projects/:id/gaps`);
    gaps.value = res.items ?? [];
  } catch {
    gaps.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => props.projectId, load, { immediate: true });

/** Gaps grouped by feature, features ordered by their top gap's score. */
const grouped = computed(() => {
  const map = new Map<string, Gap[]>();
  for (const g of gaps.value) {
    const key = g.feature ?? 'Ungrouped';
    const arr = map.get(key) ?? [];
    arr.push(g);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([feature, items]) => ({ feature, items: items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) }))
    .sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0));
});

const CLASS_COLOR: Record<string, string> = {
  'blind-spot': 'warning',
  'false-comfort': 'error',
  fragile: 'warning',
  unhandled: 'error',
  degraded: 'warning',
};

function factorLine(f: GapFactors | null): string {
  if (!f) return '';
  return `churn ${f.churn.toFixed(1)} · age ${f.age.toFixed(1)} · escape ${f.escapeHistory.toFixed(1)} · priority ${f.priority.toFixed(1)}`;
}

async function triage(gap: Gap, body: Record<string, unknown>) {
  try {
    await $fetch(`/api/projects/${props.projectId}/gaps/${gap.id}/triage` as `/api/projects/:id/gaps/:gapId/triage`, {
      method: 'POST',
      body,
    });
    await load();
  } catch {
    toast.add({ title: 'Triage failed', color: 'error' });
  }
}

async function accept(gap: Gap) {
  await triage(gap, { verb: 'accept' });
  try {
    const draft = await $fetch<{ text: string }>(
      `/api/projects/${props.projectId}/gaps/${gap.id}/draft` as `/api/projects/:id/gaps/:gapId/draft`,
      { method: 'POST' },
    );
    if (draft?.text && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(draft.text).catch(() => {});
      toast.add({ title: 'Accepted — draft copied to clipboard', color: 'success' });
      return;
    }
  } catch {
    // The draft is best-effort; acceptance already succeeded.
  }
  toast.add({ title: 'Gap accepted', color: 'success' });
}

// Covered-by modal state.
const coveredOpen = ref(false);
const coveredGap = ref<Gap | null>(null);
const coveredTestId = ref<string>('');
const coveredDismiss = ref(false);

function openCovered(gap: Gap, alsoDismiss: boolean) {
  coveredGap.value = gap;
  coveredTestId.value = '';
  coveredDismiss.value = alsoDismiss;
  coveredOpen.value = true;
}

async function submitCovered() {
  const gap = coveredGap.value;
  const id = Number(coveredTestId.value);
  if (!gap || !Number.isFinite(id)) {
    coveredOpen.value = false;
    return;
  }
  await triage(
    gap,
    coveredDismiss.value
      ? { verb: 'dismiss', reason: 'covered-elsewhere', coveringTestCaseId: id }
      : { verb: 'covered-by', coveringTestCaseId: id },
  );
  coveredOpen.value = false;
}

function snoozeItems(gap: Gap) {
  return [
    [
      { label: 'For 1 day', onSelect: () => triage(gap, { verb: 'snooze', snooze: '1-day' }) },
      { label: 'For 1 week', onSelect: () => triage(gap, { verb: 'snooze', snooze: '1-week' }) },
      {
        label: 'Until the node changes',
        onSelect: () => triage(gap, { verb: 'snooze', snooze: 'until-node-changes' }),
      },
    ],
  ];
}

function dismissItems(gap: Gap) {
  return [
    [
      { label: 'Not worth testing', onSelect: () => triage(gap, { verb: 'dismiss', reason: 'not-worth-testing' }) },
      { label: 'Covered elsewhere…', onSelect: () => openCovered(gap, true) },
      { label: 'Wrong', onSelect: () => triage(gap, { verb: 'dismiss', reason: 'wrong' }) },
    ],
  ];
}

async function recompute() {
  recomputing.value = true;
  try {
    await $fetch(`/api/projects/${props.projectId}/gaps/recompute` as `/api/projects/:id/gaps/recompute`, {
      method: 'POST',
    });
    await load();
    toast.add({ title: 'Gaps recomputed', color: 'success' });
  } catch {
    toast.add({ title: 'Recompute failed', color: 'error' });
  } finally {
    recomputing.value = false;
  }
}
</script>

<template>
  <div class="space-y-4" data-shot="gaps-panel">
    <div class="flex items-center justify-between gap-3">
      <p class="text-sm text-highlighted leading-relaxed">
        Proposed tests that do not exist yet, ranked by exposure. Every line is observed reach, never instrumented
        coverage.
      </p>
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="recomputing"
        label="Recompute"
        @click="recompute"
      />
    </div>

    <LoadingState v-if="loading && gaps.length === 0" />
    <EmptyState
      v-else-if="gaps.length === 0"
      icon="i-lucide-radar"
      text="No open gaps — recompute to look against the latest graph."
    />

    <template v-else>
      <SectionCard v-for="group in grouped" :key="group.feature" :title="group.feature">
        <div class="divide-y divide-default">
          <div v-for="gap in group.items" :key="gap.id" class="py-3 space-y-2" :data-shot="`gap-${gap.id}`">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <UBadge :color="(CLASS_COLOR[gap.class] as any) ?? 'neutral'" variant="subtle" size="sm">{{
                    gap.class
                  }}</UBadge>
                  <span v-if="gap.kind === 'finding'" class="text-xs text-muted">finding</span>
                  <span class="text-xs text-muted font-mono">{{ gap.detector }}</span>
                </div>
                <p class="mt-1 text-sm text-highlighted leading-relaxed">{{ gap.title }}</p>
                <ul class="mt-1 space-y-0.5">
                  <li v-for="(line, i) in gap.evidence" :key="i" class="text-xs text-muted">{{ line }}</li>
                </ul>
                <p class="mt-1 text-xs text-muted">
                  Score {{ (gap.score ?? 0).toFixed(3)
                  }}<span v-if="gap.factors"> · {{ factorLine(gap.factors) }}</span>
                </p>
              </div>
              <div class="shrink-0 flex items-center gap-1">
                <UButton size="xs" color="primary" label="Accept" @click="accept(gap)" />
                <UDropdownMenu :items="snoozeItems(gap)">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    label="Snooze"
                    trailing-icon="i-lucide-chevron-down"
                  />
                </UDropdownMenu>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  label="Covered by"
                  @click="openCovered(gap, false)"
                />
                <UDropdownMenu :items="dismissItems(gap)">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    label="Dismiss"
                    trailing-icon="i-lucide-chevron-down"
                  />
                </UDropdownMenu>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-radar"
                  :title="`View ${gap.subject.kind}:${gap.subject.key} in the graph`"
                  @click="graphSeed = `${gap.subject.kind}:${gap.subject.key}`"
                />
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
    </template>

    <SectionCard v-if="graphSeed" title="Feature graph">
      <template #actions>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="graphSeed = null" />
      </template>
      <FeatureGraphView
        :project-id="projectId"
        :seed-node="graphSeed"
        @select="(n) => (graphSeed = `${n.kind}:${n.key}`)"
      />
    </SectionCard>

    <UModal v-model:open="coveredOpen" :title="coveredDismiss ? 'Covered elsewhere' : 'Covered by a test'">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-highlighted">
            Enter the test case id that covers this. A manual reaches edge is written so the gap closes on the next
            recompute<span v-if="coveredDismiss"> and the gap is dismissed</span>.
          </p>
          <UInput v-model="coveredTestId" type="number" placeholder="test case id" class="w-full" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="coveredOpen = false" />
            <UButton color="primary" label="Save" @click="submitCovered" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
