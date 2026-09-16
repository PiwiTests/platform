<script setup lang="ts">
/**
 * One test in a list, read the same way everywhere: a status icon and the test
 * title on the first line with the exceptional badges and the right-side metrics
 * (duration, browser, retries, wasted time, cluster), the failure headline on
 * the second line, and the source path on the third. The whole row reflows to a
 * single column on a phone, so it reads as a card with no horizontal scroll.
 *
 * Built to be reused by the run's Tests tab, the cluster's affected-tests list,
 * the run's Changes tab, the project catalog, the flaky and quarantine lists and
 * the test history page. An execution is passed as `testCase`; a list whose rows
 * are not executions (the project catalog, a flaky or quarantined test, an entry
 * in a test's history) passes the identity and status directly and supplies its
 * own right-side facts through the `metrics` slot, an extra line through the
 * `subline` slot, and its own link through `href`.
 */
import type { TestCaseResult } from '~~/types/api';
import type { LiveStepInfo } from '~/utils/live-steps';
import type { TestRowBadge } from '~/utils/test-row-badges';
import { badgesFromTestCase } from '~/utils/test-row-badges';

const props = withDefaults(
  defineProps<{
    /** The execution this row shows. Omit for a test-level or history row. */
    testCase?: TestCaseResult | null;
    /** Link the row opens; defaults to the execution page for an execution. */
    href?: string | null;
    /** Title override, when the row is not built from an execution. */
    title?: string | null;
    /** Status override that drives the left icon (defaults to the execution's). */
    status?: string | null;
    /** Left-icon override; defaults to the status glyph. */
    icon?: string | null;
    iconClass?: string | null;
    /** Source path (`file:line:col` or a bare path) for the third line. */
    location?: string | null;
    filePath?: string | null;
    /** Failure headline source, when the row is not built from an execution. */
    error?: string | null;
    steps?: TestCaseResult['steps'] | null;
    /** Badge list override; defaults to the execution's badges. */
    badges?: TestRowBadge[] | null;
    /** Resolved cluster display name; falls back to the id when absent. */
    clusterName?: string | null;
    /** Show the failing row's cluster chip on the right. */
    showCluster?: boolean;
    quarantined?: boolean;
    /** Render a selection checkbox on a failing row and reflect `selected`. */
    selectable?: boolean;
    selected?: boolean;
    /**
     * Make the whole row a selector: a click anywhere (and the title) emits
     * `select` instead of navigating, and `active` reflects the chosen row. Used
     * by the cluster page's affected-tests list to switch the evidence.
     */
    selectOnClick?: boolean;
    active?: boolean;
    /** The step this row's worker is on right now (live runs only). */
    liveStep?: LiveStepInfo | null;
    highlighted?: boolean;
    projectKey?: string | number | null;
    projectName?: string | null;
    /** How many badges to show before the rest fold into `+N`. */
    badgeMax?: number;
    /** Extra left padding in px, to indent a row under a nested group header. */
    indent?: number;
  }>(),
  {
    testCase: null,
    href: null,
    title: null,
    status: null,
    icon: null,
    iconClass: null,
    location: null,
    filePath: null,
    error: null,
    steps: null,
    badges: null,
    clusterName: null,
    showCluster: true,
    quarantined: false,
    selectable: false,
    selected: false,
    selectOnClick: false,
    active: false,
    liveStep: null,
    highlighted: false,
    projectKey: null,
    projectName: null,
    badgeMax: 3,
    indent: 0,
  },
);

const emit = defineEmits<{ toggle: []; select: [] }>();

const tc = computed(() => props.testCase);

const title = computed(() => props.title ?? tc.value?.title ?? '');
const status = computed(() => props.status ?? tc.value?.status ?? 'unknown');
const failed = computed(() => isFailedStatus(status.value));
const href = computed(() => props.href ?? (tc.value ? `/test-run-cases/${tc.value.executionId}` : '#'));
// A live-streamed row carries a negative placeholder executionId until its
// run-case row is persisted — render its title as plain text, not a link to
// some unrelated execution that happens to own the fabricated id.
const linkable = computed(() => (props.href != null ? true : tc.value ? tc.value.executionId > 0 : true));
const errorText = computed(() => props.error ?? tc.value?.error ?? null);
const stepsData = computed(() => props.steps ?? tc.value?.steps ?? null);
const locationPath = computed(() => props.location ?? tc.value?.location ?? null);

const badges = computed<TestRowBadge[]>(
  () => props.badges ?? (tc.value ? badgesFromTestCase(tc.value, { quarantined: props.quarantined }) : []),
);

const statusIcon = computed(() => props.icon ?? getStatusIcon(status.value));
const statusIconClass = computed(() => props.iconClass ?? getStatusTextClass(status.value));

const statusHint = computed(() =>
  tc.value && tc.value.status === 'didnotrun'
    ? formatDidNotRunReason(tc.value.didNotRunReason)
    : formatStatusLabel(status.value),
);

const clusterLabel = computed(() =>
  tc.value?.failureClusterId != null ? (props.clusterName ?? `Cluster #${tc.value.failureClusterId}`) : '',
);
</script>

<template>
  <div
    class="border-b border-default px-3 py-2.5 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
    :class="[
      highlighted ? 'animate-pulse bg-yellow-100 dark:bg-yellow-900/30' : '',
      active ? 'bg-primary/5 ring-1 ring-inset ring-primary/40' : '',
      selectOnClick ? 'cursor-pointer' : '',
    ]"
    :style="indent ? { paddingLeft: `${12 + indent}px` } : undefined"
    :role="selectOnClick ? 'button' : undefined"
    :aria-pressed="selectOnClick ? (active ? 'true' : 'false') : undefined"
    :tabindex="selectOnClick ? 0 : undefined"
    @click="selectOnClick ? emit('select') : undefined"
    @keydown.enter.self="selectOnClick ? emit('select') : undefined"
    @keydown.space.self.prevent="selectOnClick ? emit('select') : undefined"
  >
    <div class="flex items-start gap-2 min-w-0">
      <input
        v-if="selectable"
        type="checkbox"
        class="size-4 shrink-0 mt-0.5 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-primary rounded"
        :checked="selected"
        :aria-label="`Select ${title}`"
        @click.stop
        @change="emit('toggle')"
      />
      <span class="size-4 shrink-0 mt-0.5" role="img" :aria-label="`Status: ${statusHint}`" :title="statusHint">
        <UIcon
          :name="statusIcon"
          class="size-4"
          :class="[statusIconClass, isStatusInFlight(status) ? 'animate-spin' : '']"
        />
      </span>

      <div class="flex-1 min-w-0 space-y-1">
        <!-- Line 1: title, badges, then the right-side metrics -->
        <div class="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
          <!-- Neutral title: a primary-green title reads as "passed" on a failed row. -->
          <a
            v-if="linkable"
            :href="href"
            class="text-highlighted hover:text-primary hover:underline font-medium break-words min-w-0"
            :title="title"
            @click.prevent="selectOnClick ? emit('select') : navigateTo(href)"
            >{{ title }}</a
          >
          <span v-else class="text-highlighted font-medium break-words min-w-0" :title="title">{{ title }}</span>
          <BadgeGroup :badges="badges" :max="badgeMax" />

          <div class="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 ml-auto min-w-0 text-xs text-muted">
            <slot name="metrics">
              <template v-if="tc">
                <template v-if="tc.status === 'running'">
                  <span v-if="!liveStep" class="text-info">In progress…</span>
                </template>
                <DurationValue v-else-if="tc.duration" :ms="tc.duration" />
                <BrowserBadge :browser="tc.browser" size="sm" />
                <UBadge
                  v-if="(tc.retries ?? 0) > 0"
                  color="warning"
                  variant="soft"
                  size="xs"
                  :title="`${tc.retries} retries`"
                >
                  {{ tc.retries }}x
                </UBadge>
                <span
                  v-if="tc.wastedTimeMs"
                  class="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
                  title="Wasted in fixed waits"
                >
                  <UIcon name="i-lucide-hourglass" class="size-3 shrink-0" />
                  <DurationValue :ms="tc.wastedTimeMs" unit-class="opacity-60" no-title />
                </span>
                <NuxtLink
                  v-if="showCluster && tc.failureClusterId"
                  :to="`/failure-clusters/${tc.failureClusterId}`"
                  class="shrink-0"
                  @click.stop
                >
                  <UBadge color="info" variant="subtle" size="xs" class="max-w-44">
                    <span class="truncate">{{ clusterLabel }}</span>
                  </UBadge>
                </NuxtLink>
              </template>
            </slot>
          </div>
        </div>

        <FailureHeadline
          v-if="failed && errorText"
          :error="errorText"
          :steps="stepsData"
          truncate
          class="text-xs text-gray-600 dark:text-gray-400"
        />

        <OpenInIdeLink
          v-if="locationPath || filePath"
          :location="locationPath"
          :file-path="filePath ?? undefined"
          :project-key="projectKey"
          :project-name="projectName"
          class="block text-xs text-zinc-400 dark:text-zinc-500"
        />

        <slot name="subline" />

        <TestRowLiveStep v-if="liveStep" :step="liveStep" class="max-w-full" />
      </div>
    </div>
  </div>
</template>
