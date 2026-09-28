<script setup lang="ts">
/**
 * The Flakiness tab of a flaky test: the suspects its history points at, each
 * with the counts behind it (failures and passes showing the factor, out of
 * all) and the condition a lab would apply to test it; then the factors with
 * no condition, as context; then where experiments will go.
 *
 * Loaded from `/flake-profile` when the tab mounts (under a `v-if`). The
 * `suspect` query parameter, set by a link from the Attempts diff, marks one
 * suspect and scrolls to it.
 */
import type { FlakeProfile, FlakeSuspect } from '#shared/handlers/flake-profile';

const props = defineProps<{ testCaseId: number }>();

const route = useRoute();
const profile = ref<FlakeProfile | null>(null);
const loading = ref(true);
const failed = ref(false);

watch(
  () => props.testCaseId,
  async (id) => {
    loading.value = true;
    failed.value = false;
    try {
      profile.value = await $fetch<FlakeProfile>(`/api/test-cases/${id}/flake-profile`);
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

const marked = computed(() => (typeof route.query.suspect === 'string' ? route.query.suspect : null));

// Scroll the marked suspect into view once the list renders.
watch(
  () => [profile.value, marked.value] as const,
  async ([p, id]) => {
    if (!p || !id || !import.meta.client) return;
    await nextTick();
    document.querySelector(`[data-suspect-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
  },
);

const windowLine = computed(() => {
  const p = profile.value;
  if (!p) return '';
  const attempts = p.attempts === 1 ? '1 attempt' : `${p.attempts} attempts`;
  return `${attempts} in the last ${p.windowDays} days: ${p.failures} failed, ${p.passes} passed`;
});

function detailLine(s: FlakeSuspect): string | null {
  const parts: string[] = [];
  if (s.sharedRoutes?.length) parts.push(`Both write ${s.sharedRoutes.join(', ')}`);
  if (s.approximate) parts.push('Overlap across shards, approximate: their clocks agree only roughly');
  return parts.length ? parts.join(' · ') : null;
}
</script>

<template>
  <div class="space-y-4" data-shot="flakiness-tab">
    <SectionCard
      icon="i-lucide-search-check"
      title="Suspects"
      help="case.flakiness"
      :subtitle="windowLine || undefined"
    >
      <LoadingState v-if="loading" text="Reading this test’s history…" />
      <ErrorState v-else-if="failed" text="Could not load the suspects." />
      <EmptyState
        v-else-if="profile && profile.suspects.length === 0"
        icon="i-lucide-search-x"
        :text="
          profile.failures < 3
            ? 'Fewer than 3 failures in this test’s window — too few to rank suspects.'
            : 'Nothing in this test’s history separates its failures from its passes.'
        "
      />

      <div v-else-if="profile" data-testid="flake-suspects">
        <!-- From md up the rows line up as columns; below it each row stacks. -->
        <div
          class="hidden md:grid md:grid-cols-[minmax(0,1fr)_6rem_6rem_10rem] gap-x-4 px-3 pb-2 text-xs text-muted"
          aria-hidden="true"
        >
          <span>Suspect</span>
          <span class="text-right">Failures</span>
          <span class="text-right">Passes</span>
          <span>Condition</span>
        </div>
        <ol class="rounded-lg border border-default divide-y divide-default">
          <li
            v-for="(s, i) in profile.suspects"
            :key="s.id"
            :data-suspect-id="s.id"
            class="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_6rem_6rem_10rem] gap-x-4 gap-y-1 px-3 py-2.5"
            :class="marked === s.id ? 'bg-primary/5 ring-1 ring-inset ring-primary/40' : ''"
            data-testid="flake-suspect"
          >
            <div class="col-span-2 md:col-span-1 min-w-0 space-y-0.5">
              <p class="text-sm font-semibold text-highlighted break-words" :title="s.sentence">
                <span class="text-muted tabular-nums">{{ i + 1 }}</span>
                {{ s.label }}
              </p>
              <p v-if="detailLine(s)" class="text-xs text-muted break-words">{{ detailLine(s) }}</p>
            </div>
            <p
              class="text-sm text-highlighted tabular-nums md:text-right"
              :title="`${s.counts.failuresWith} of ${s.counts.failures} failures`"
            >
              <span class="md:hidden text-xs text-muted">Failures </span>{{ s.counts.failuresWith }}/{{
                s.counts.failures
              }}
            </p>
            <p
              class="text-sm text-highlighted tabular-nums md:text-right"
              :title="`${s.counts.passesWith} of ${s.counts.passes} passes`"
            >
              <span class="md:hidden text-xs text-muted">Passes </span>{{ s.counts.passesWith }}/{{ s.counts.passes }}
            </p>
            <p class="col-span-2 md:col-span-1 text-sm text-highlighted">
              <span class="md:hidden text-xs text-muted">Condition </span>{{ s.conditionLabel }}
            </p>
          </li>
        </ol>
      </div>
    </SectionCard>

    <SectionCard v-if="profile && profile.context.length && profile.failures > 0" icon="i-lucide-info" title="Context">
      <p class="text-xs text-muted mb-2">Factors a lab cannot apply, shown with the same counts.</p>
      <ul class="space-y-1" data-testid="flake-context">
        <li v-for="c in profile.context" :key="c.kind" class="text-sm text-highlighted">
          {{ c.label.charAt(0).toUpperCase() + c.label.slice(1) }}:
          <span class="tabular-nums">{{ c.counts.failuresWith }} of {{ c.counts.failures }} failures</span>,
          <span class="tabular-nums">{{ c.counts.passesWith }} of {{ c.counts.passes }} passes</span>
        </li>
      </ul>
    </SectionCard>

    <SectionCard icon="i-lucide-flask-conical" title="Experiments">
      <p class="text-sm text-highlighted leading-relaxed" data-testid="flake-experiments">
        None yet. A later release adds the lab: it applies each suspect’s condition next to a control run until the
        failure reproduces. In the desktop app, Reproduce locally runs this test 20 times with a trace.
      </p>
    </SectionCard>
  </div>
</template>
