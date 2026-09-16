<script setup lang="ts">
import { computed, nextTick, watch, ref, onUnmounted } from 'vue';
import type { TestCaseResult } from '~~/types/api';
import type { LiveStepInfo, LiveStepsByWorker } from '~/utils/live-steps';

/** Cluster id → its display name and triage status, for the row chip and the
 *  cluster group header. Supplied by the page from the failure-groups payload. */
type ClusterMeta = Record<number, { name: string; status: string | null }>;

type GroupBy = 'cluster' | 'file' | 'file-describe' | 'lock' | 'none';

const props = defineProps<{
  testCases: TestCaseResult[];
  isLive: boolean;
  /** Worker index → current step, rendered inline on the matching running rows. */
  liveSteps?: LiveStepsByWorker | null;
  clusterMeta?: ClusterMeta | null;
  /** Stable test-case ids currently quarantined — marks the matching rows. */
  quarantinedCaseIds?: Set<number> | null;
  /** Piwi project id + name, threaded so the IDE opener can resolve a workspace root. */
  projectKey?: string | number | null;
  projectName?: string | null;
}>();

const emit = defineEmits<{ 'quarantine-changed': [] }>();

function isQuarantined(tc: TestCaseResult): boolean {
  return Boolean(props.quarantinedCaseIds?.has(tc.testCaseId));
}

function clusterName(id: number): string {
  return props.clusterMeta?.[id]?.name ?? `Cluster #${id}`;
}

function liveStep(tc: TestCaseResult): LiveStepInfo | null {
  return liveStepForCase(props.liveSteps, tc);
}

// Filter state is owned by the parent page so it survives tab switches.
const testCaseSearch = defineModel<string>('search', { default: '' });
const activeStatuses = defineModel<string[]>('activeStatuses', { default: () => [] });
const testCaseBrowserFilter = defineModel<string>('browserFilter', { default: 'all' });

const showNewRegressionsOnly = ref(false);
const showNewFlakyOnly = ref(false);
const testCaseLockFilter = ref('all');

/** Lock names present anywhere in this run, for the lock filter dropdown. */
const testCaseLockOptions = computed(() => {
  const locks = new Set<string>();
  for (const tc of props.testCases) for (const lock of tc.locks ?? []) locks.add(lock);
  const items = [{ label: 'All locks', value: 'all' }];
  for (const lock of [...locks].sort()) items.push({ label: lock, value: lock });
  return items;
});

/** True when at least one execution in the run carries a lock. */
const hasAnyLocks = computed(() => props.testCases.some((tc) => (tc.locks?.length ?? 0) > 0));

const STATUS_OPTIONS = [
  { label: 'Passed', value: 'passed', color: 'green' },
  { label: 'Failed', value: 'failed', color: 'red' },
  { label: 'Passed on retry', value: 'flaky', color: 'orange' },
  { label: 'Skipped', value: 'skipped', color: 'gray' },
  { label: "Didn't run", value: 'didnotrun', color: 'amber' },
] as const;

function toggleStatus(value: string) {
  activeStatuses.value = activeStatuses.value.includes(value)
    ? activeStatuses.value.filter((s) => s !== value)
    : [...activeStatuses.value, value];
}

const testCaseBrowserOptions = computed(() => {
  const browsers = new Set<string>();
  for (const tc of props.testCases) {
    const name = tc.browser?.projectName;
    if (name) browsers.add(name);
  }
  const items = [{ label: 'All browsers', value: 'all' }];
  for (const b of [...browsers].sort()) items.push({ label: b, value: b });
  return items;
});

function matchesStatus(tc: TestCaseResult, filter: string): boolean {
  if (filter === 'failed') return isFailedStatus(tc.status);
  // "Passed on retry" means passed only after a retry — a subset of passed.
  if (filter === 'flaky') return tc.status === 'passed' && (tc.retries ?? 0) > 0;
  return tc.status === filter;
}

const filteredTestCases = computed<TestCaseResult[]>(() => {
  let cases = props.testCases;
  if (activeStatuses.value.length > 0) {
    cases = cases.filter((tc) => activeStatuses.value.some((s) => matchesStatus(tc, s)));
  }
  if (testCaseBrowserFilter.value !== 'all') {
    cases = cases.filter((tc) => tc.browser?.projectName === testCaseBrowserFilter.value);
  }
  if (testCaseSearch.value) {
    // Search matches the title, the path AND the error text, so a failure is
    // findable by what broke, not only by which test broke.
    const query = testCaseSearch.value.toLowerCase();
    cases = cases.filter(
      (tc) =>
        tc.title.toLowerCase().includes(query) ||
        tc.location?.toLowerCase().includes(query) ||
        tc.error?.toLowerCase().includes(query),
    );
  }
  if (showNewRegressionsOnly.value) cases = cases.filter((tc) => tc.isNewRegression);
  if (showNewFlakyOnly.value) cases = cases.filter((tc) => tc.isNewFlaky);
  if (testCaseLockFilter.value !== 'all') {
    cases = cases.filter((tc) => (tc.locks ?? []).includes(testCaseLockFilter.value));
  }
  return cases;
});

// ── Sort (inside each group) ────────────────────────────────────────────────
const SORT_NATURAL = 'natural';
const sortKey = ref<string>(SORT_NATURAL);
const sortDir = ref<'asc' | 'desc'>('asc');

const failedCount = computed(() => props.testCases.filter((tc) => isFailedStatus(tc.status)).length);

const sortOptions = computed(() => [
  { label: failedCount.value > 0 ? 'Failures first' : 'Run order', value: SORT_NATURAL },
  { label: 'Title', value: 'title' },
  { label: 'Status', value: 'status' },
  { label: 'Duration', value: 'duration' },
  { label: 'Worker', value: 'workerIndex' },
  { label: 'Retries', value: 'retries' },
  { label: 'Wasted', value: 'wastedTimeMs' },
]);

function sortValue(tc: TestCaseResult, key: string): string | number {
  switch (key) {
    case 'title':
      return tc.title ?? '';
    case 'status':
      return isFailedStatus(tc.status) ? 'failed' : (tc.status ?? '');
    case 'duration':
      return tc.duration ?? 0;
    case 'workerIndex':
      return tc.workerIndex ?? -1;
    case 'retries':
      return tc.retries ?? 0;
    case 'wastedTimeMs':
      return tc.wastedTimeMs ?? 0;
    default:
      return '';
  }
}

function sortCases(cases: TestCaseResult[]): TestCaseResult[] {
  if (sortKey.value === SORT_NATURAL) {
    if (failedCount.value === 0) return cases;
    return [...cases].sort((a, b) => failureFirstCompare(a.status, b.status));
  }
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...cases].sort((a, b) => {
    const va = sortValue(a, sortKey.value);
    const vb = sortValue(b, sortKey.value);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

// ── Grouping ────────────────────────────────────────────────────────────────
const { raw: storedGroup, set: setGroup } = useGroupByCookie('run-tests', [
  'cluster',
  'file',
  'file-describe',
  'lock',
  'none',
]);
const groupBy = computed<GroupBy>({
  // A red run opens on the cluster grouping; a green run has no clusters, so it
  // opens flat. A saved choice always wins.
  get: () => {
    const stored = storedGroup.value as GroupBy | null;
    // A saved "lock" choice is meaningless on a run with no locks — fall back.
    if (stored === 'lock' && !hasAnyLocks.value) return failedCount.value > 0 ? 'cluster' : 'none';
    return stored ?? (failedCount.value > 0 ? 'cluster' : 'none');
  },
  set: (v) => setGroup(v),
});
const groupByItems = computed(() => [
  { label: 'Cluster', value: 'cluster' },
  { label: 'File', value: 'file' },
  { label: 'File + Describe', value: 'file-describe' },
  // Only offer lock grouping when the run actually declared locks.
  ...(hasAnyLocks.value ? [{ label: 'Lock', value: 'lock' }] : []),
  { label: 'None', value: 'none' },
]);

// The quiet buckets (passed, skipped, didn't run) start collapsed; every other
// group starts open. A user click flips a group from its default; a filter
// forces everything open so a match is never hidden behind a collapsed header.
const DEFAULT_COLLAPSED_BUCKETS = new Set(['bucket:passed', 'bucket:skipped', 'bucket:didnotrun', 'lock:none']);
const userToggled = ref(new Set<string>());
const hasFilter = computed(
  () =>
    testCaseSearch.value !== '' ||
    activeStatuses.value.length > 0 ||
    testCaseBrowserFilter.value !== 'all' ||
    testCaseLockFilter.value !== 'all' ||
    showNewRegressionsOnly.value ||
    showNewFlakyOnly.value,
);
function defaultOpen(key: string): boolean {
  return !DEFAULT_COLLAPSED_BUCKETS.has(key);
}
function isOpen(key: string): boolean {
  if (hasFilter.value) return true;
  return userToggled.value.has(key) ? !defaultOpen(key) : defaultOpen(key);
}
function toggleGroup(key: string) {
  const next = new Set(userToggled.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  userToggled.value = next;
}

interface GroupHeaderItem {
  kind: 'group';
  key: string;
  label: string;
  count: number;
  icon?: string;
  triageStatus?: string | null;
  clusterId?: number | null;
  stats?: { passed: number; failed: number; skipped: number; didnotrun: number; running: number } | null;
  filePath?: string | null;
  /** Nesting depth for the File + Describe grouping (0 = file). */
  depth?: number;
}
interface TestItem {
  kind: 'test';
  key: string;
  tc: TestCaseResult;
  /** Nesting depth of the row's group, so a nested test indents under it. */
  depth?: number;
}
type Row = GroupHeaderItem | TestItem;

function computeStats(cases: TestCaseResult[]) {
  const s = { passed: 0, failed: 0, skipped: 0, didnotrun: 0, running: 0 };
  for (const tc of cases) {
    if (isFailedStatus(tc.status)) s.failed++;
    else if (tc.status === 'passed') s.passed++;
    else if (tc.status === 'skipped') s.skipped++;
    else if (tc.status === 'didnotrun') s.didnotrun++;
    else if (tc.status === 'running') s.running++;
  }
  return s;
}

/** The remainder buckets (non-failing) shown as their own groups; the quiet
 *  ones start collapsed (see `DEFAULT_COLLAPSED_BUCKETS`). */
const REMAINDER_BUCKETS: Array<{ key: string; label: string; match: (tc: TestCaseResult) => boolean }> = [
  { key: 'running', label: 'Running', match: (tc) => tc.status === 'running' },
  { key: 'passed', label: 'Passed', match: (tc) => tc.status === 'passed' },
  { key: 'skipped', label: 'Skipped', match: (tc) => tc.status === 'skipped' },
  { key: 'didnotrun', label: "Didn't run", match: (tc) => tc.status === 'didnotrun' },
];

const rows = computed<Row[]>(() => {
  const cases = filteredTestCases.value;

  if (groupBy.value === 'none') {
    return sortCases(cases).map((tc) => ({ kind: 'test', key: `t${tc.executionId}`, tc }) as TestItem);
  }

  const out: Row[] = [];

  if (groupBy.value === 'file') {
    const byFile = new Map<string, TestCaseResult[]>();
    for (const tc of cases) {
      const fp = tc.filePath ?? 'unknown';
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp)!.push(tc);
    }
    for (const [filePath, fileCases] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const key = `file:${filePath}`;
      out.push({
        kind: 'group',
        key,
        label: filePath,
        count: fileCases.length,
        icon: 'i-lucide-file-code-2',
        filePath,
        stats: computeStats(fileCases),
      });
      if (isOpen(key)) for (const tc of sortCases(fileCases)) out.push({ kind: 'test', key: `t${tc.executionId}`, tc });
    }
    return out;
  }

  if (groupBy.value === 'file-describe') {
    const byFile = new Map<string, TestCaseResult[]>();
    for (const tc of cases) {
      const fp = tc.filePath ?? 'unknown';
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp)!.push(tc);
    }
    // Recurse the describe hierarchy: a group per suitePath segment, then the
    // tests declared directly at this level. Sort applies within each level.
    const addLevel = (levelCases: TestCaseResult[], filePath: string, parentSuite: string[], depth: number) => {
      const parentLen = parentSuite.length;
      const direct = levelCases.filter((t) => (t.suitePath ?? []).length === parentLen);
      const nested = levelCases.filter((t) => (t.suitePath ?? []).length > parentLen);
      const groups = new Map<string, TestCaseResult[]>();
      for (const t of nested) {
        const seg = (t.suitePath ?? [])[parentLen]!;
        if (!groups.has(seg)) groups.set(seg, []);
        groups.get(seg)!.push(t);
      }
      for (const [seg, groupTests] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const groupPath = [...parentSuite, seg];
        const key = `describe:${filePath}\x1f${groupPath.join('\x1f')}`;
        out.push({
          kind: 'group',
          key,
          label: seg,
          count: groupTests.length,
          icon: 'i-lucide-folder',
          depth,
          stats: computeStats(groupTests),
        });
        if (isOpen(key)) addLevel(groupTests, filePath, groupPath, depth + 1);
      }
      for (const tc of sortCases(direct)) out.push({ kind: 'test', key: `t${tc.executionId}`, tc, depth });
    };
    for (const [filePath, fileCases] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const key = `file:${filePath}`;
      out.push({
        kind: 'group',
        key,
        label: filePath,
        count: fileCases.length,
        icon: 'i-lucide-file-code-2',
        filePath,
        stats: computeStats(fileCases),
        depth: 0,
      });
      if (isOpen(key)) addLevel(fileCases, filePath, [], 1);
    }
    return out;
  }

  if (groupBy.value === 'lock') {
    // A group per lock name; a test holding several locks appears under each.
    // Tests with no lock fall into a trailing "No lock" group.
    const byLock = new Map<string, TestCaseResult[]>();
    const noLock: TestCaseResult[] = [];
    for (const tc of cases) {
      const locks = tc.locks ?? [];
      if (locks.length === 0) noLock.push(tc);
      else
        for (const lock of locks) {
          if (!byLock.has(lock)) byLock.set(lock, []);
          byLock.get(lock)!.push(tc);
        }
    }
    for (const [lock, lockCases] of [...byLock.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const key = `lock:${lock}`;
      out.push({
        kind: 'group',
        key,
        label: lock,
        count: lockCases.length,
        icon: 'i-lucide-lock',
        stats: computeStats(lockCases),
      });
      if (isOpen(key))
        for (const tc of sortCases(lockCases)) out.push({ kind: 'test', key: `t${tc.executionId}:${lock}`, tc });
    }
    if (noLock.length > 0) {
      const key = 'lock:none';
      out.push({ kind: 'group', key, label: 'No lock', count: noLock.length, stats: computeStats(noLock) });
      if (isOpen(key))
        for (const tc of sortCases(noLock)) out.push({ kind: 'test', key: `t${tc.executionId}:nolock`, tc });
    }
    return out;
  }

  // Cluster grouping: failing clustered tests first (largest cluster first),
  // then ungrouped failures, then the non-failing remainder as collapsed groups.
  const failing = cases.filter((tc) => isFailedStatus(tc.status));
  const byCluster = new Map<number, TestCaseResult[]>();
  const ungrouped: TestCaseResult[] = [];
  for (const tc of failing) {
    if (tc.failureClusterId != null) {
      if (!byCluster.has(tc.failureClusterId)) byCluster.set(tc.failureClusterId, []);
      byCluster.get(tc.failureClusterId)!.push(tc);
    } else {
      ungrouped.push(tc);
    }
  }
  const clusterGroups = [...byCluster.entries()].sort(([, a], [, b]) => b.length - a.length);
  for (const [clusterId, clusterCases] of clusterGroups) {
    const key = `cluster:${clusterId}`;
    out.push({
      kind: 'group',
      key,
      label: clusterName(clusterId),
      count: clusterCases.length,
      icon: 'i-lucide-layers',
      clusterId,
      triageStatus: props.clusterMeta?.[clusterId]?.status ?? null,
    });
    if (isOpen(key))
      for (const tc of sortCases(clusterCases)) out.push({ kind: 'test', key: `t${tc.executionId}`, tc });
  }
  if (ungrouped.length > 0) {
    const key = 'cluster:none';
    out.push({ kind: 'group', key, label: 'Ungrouped failures', count: ungrouped.length, icon: 'i-lucide-circle-x' });
    if (isOpen(key)) for (const tc of sortCases(ungrouped)) out.push({ kind: 'test', key: `t${tc.executionId}`, tc });
  }
  for (const bucket of REMAINDER_BUCKETS) {
    const bucketCases = cases.filter(bucket.match);
    if (bucketCases.length === 0) continue;
    const key = `bucket:${bucket.key}`;
    out.push({ kind: 'group', key, label: bucket.label, count: bucketCases.length });
    if (isOpen(key)) for (const tc of sortCases(bucketCases)) out.push({ kind: 'test', key: `t${tc.executionId}`, tc });
  }
  return out;
});

// Every group key an execution sits under (a nested describe row has several),
// so a jump from the timeline can open the whole chain even when collapsed —
// derived from the data, not the visible rows, so a hidden row is locatable.
const groupKeysByExecution = computed(() => {
  const map = new Map<number, string[]>();
  if (groupBy.value === 'none') return map;
  for (const tc of filteredTestCases.value) {
    const fp = tc.filePath ?? 'unknown';
    if (groupBy.value === 'lock') {
      const locks = tc.locks ?? [];
      map.set(tc.executionId, locks.length ? locks.map((l) => `lock:${l}`) : ['lock:none']);
    } else if (groupBy.value === 'file') {
      map.set(tc.executionId, [`file:${fp}`]);
    } else if (groupBy.value === 'file-describe') {
      const keys = [`file:${fp}`];
      const sp = tc.suitePath ?? [];
      for (let i = 1; i <= sp.length; i++) keys.push(`describe:${fp}\x1f${sp.slice(0, i).join('\x1f')}`);
      map.set(tc.executionId, keys);
    } else if (isFailedStatus(tc.status)) {
      map.set(tc.executionId, [tc.failureClusterId != null ? `cluster:${tc.failureClusterId}` : 'cluster:none']);
    } else {
      const bucket = REMAINDER_BUCKETS.find((b) => b.match(tc));
      if (bucket) map.set(tc.executionId, [`bucket:${bucket.key}`]);
    }
  }
  return map;
});

const finishedCount = computed(() => props.testCases.filter((tc) => tc.status !== 'running').length);
const visibleTestCount = computed(() => rows.value.filter((r) => r.kind === 'test').length);

// ── Bulk triage (works in every grouping) ────────────────────────────────────
const toast = useToast();
const { canWrite } = useAuth();
const { quarantineMany } = useQuarantine(() => props.projectKey ?? null);

const selectionEnabled = computed(() => canWrite.value && failedCount.value > 0);
const selectedIds = ref<Set<number>>(new Set());

const selectableRows = computed(() => filteredTestCases.value.filter((tc) => isFailedStatus(tc.status)));
const selectedRows = computed(() => selectableRows.value.filter((tc) => selectedIds.value.has(tc.executionId)));
const selectedCount = computed(() => selectedRows.value.length);
const allSelectableSelected = computed(
  () => selectableRows.value.length > 0 && selectableRows.value.every((tc) => selectedIds.value.has(tc.executionId)),
);
const someSelectableSelected = computed(
  () => selectableRows.value.some((tc) => selectedIds.value.has(tc.executionId)) && !allSelectableSelected.value,
);

function toggleRow(tc: TestCaseResult) {
  const next = new Set(selectedIds.value);
  if (next.has(tc.executionId)) next.delete(tc.executionId);
  else next.add(tc.executionId);
  selectedIds.value = next;
}
function toggleAll() {
  selectedIds.value = allSelectableSelected.value
    ? new Set()
    : new Set(selectableRows.value.map((tc) => tc.executionId));
}
function clearSelection() {
  selectedIds.value = new Set();
}

// Drop ids no longer selectable when the filter/data changes.
watch([selectableRows, selectionEnabled], () => {
  if (!selectionEnabled.value) {
    if (selectedIds.value.size > 0) selectedIds.value = new Set();
    return;
  }
  const stillSelectable = new Set(selectableRows.value.map((tc) => tc.executionId));
  const filtered = new Set([...selectedIds.value].filter((id) => stillSelectable.has(id)));
  if (filtered.size !== selectedIds.value.size) selectedIds.value = filtered;
});

const selectedTestCaseIds = computed(() => [...new Set(selectedRows.value.map((tc) => tc.testCaseId))]);
const selectedClusterIds = computed(() => [
  ...new Set(selectedRows.value.map((tc) => tc.failureClusterId).filter((id): id is number => id != null)),
]);
const allSelectedInCluster = computed(
  () => selectedCount.value > 0 && selectedRows.value.every((tc) => tc.failureClusterId != null),
);

const bulkBusy = ref(false);
const quarantineConfirmOpen = ref(false);

async function runBulkQuarantine() {
  const ids = selectedTestCaseIds.value;
  if (ids.length === 0) return;
  bulkBusy.value = true;
  try {
    const { succeeded, failed } = await quarantineMany(ids, () => 'Quarantined from run');
    if (failed === 0) {
      toast.add({ title: `Quarantined ${succeeded} test${succeeded === 1 ? '' : 's'}`, color: 'success' });
    } else {
      toast.add({
        title: `Quarantined ${succeeded} of ${ids.length}`,
        description: `${failed} could not be quarantined.`,
        color: succeeded > 0 ? 'warning' : 'error',
      });
    }
    if (succeeded > 0) {
      emit('quarantine-changed');
      clearSelection();
    }
  } finally {
    bulkBusy.value = false;
    quarantineConfirmOpen.value = false;
  }
}

async function setClusterStatus(status: 'open' | 'resolved' | 'ignored') {
  const clusterIds = selectedClusterIds.value;
  if (clusterIds.length === 0) return;
  bulkBusy.value = true;
  let succeeded = 0;
  let failed = 0;
  try {
    for (const clusterId of clusterIds) {
      try {
        await $fetch(`/api/failure-clusters/${clusterId}/status`, { method: 'PATCH', body: { status } });
        succeeded++;
      } catch {
        failed++;
      }
    }
    const label = `${succeeded} cluster${succeeded === 1 ? '' : 's'} set to ${status}`;
    if (failed === 0) toast.add({ title: label, color: 'success' });
    else
      toast.add({
        title: label,
        description: `${failed} could not be updated.`,
        color: succeeded > 0 ? 'warning' : 'error',
      });
    if (succeeded > 0) clearSelection();
  } finally {
    bulkBusy.value = false;
  }
}

const QUARANTINE_CONFIRM_THRESHOLD = 3;
function onBulkQuarantine() {
  if (selectedTestCaseIds.value.length > QUARANTINE_CONFIRM_THRESHOLD) quarantineConfirmOpen.value = true;
  else runBulkQuarantine();
}

// ── Virtualized scroller ─────────────────────────────────────────────────────
const scrollerRef = ref<{
  scrollToItem: (index: number, options?: ScrollToOptions) => void;
  scrollToBottom: () => void;
} | null>(null);
const userScrolledAway = ref(false);
const highlightedCaseId = ref<number | null>(null);

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
}
function onScrollerScroll(event: Event) {
  const el = event.target as HTMLElement | null;
  if (el) userScrolledAway.value = !isAtBottom(el);
}
watch(
  () => props.isLive,
  (live) => {
    if (!live) userScrolledAway.value = false;
  },
);
watch(
  () => rows.value.length,
  () => {
    if (!props.isLive || userScrolledAway.value) return;
    nextTick(() => scrollerRef.value?.scrollToBottom());
  },
);

function scrollToCase(id: number) {
  // Open every group in the row's chain, then scroll to it and flash it.
  const groupKeys = groupKeysByExecution.value.get(id) ?? [];
  const next = new Set(userToggled.value);
  for (const groupKey of groupKeys) {
    if (isOpen(groupKey)) continue;
    // Flip the group toward open: for a default-open group that the user closed,
    // drop the toggle; for a default-collapsed bucket, add the toggle.
    if (defaultOpen(groupKey)) next.delete(groupKey);
    else next.add(groupKey);
  }
  userToggled.value = next;
  highlightedCaseId.value = id;
  const doScroll = () => {
    const index = rows.value.findIndex((r) => r.kind === 'test' && r.tc.executionId === id);
    if (index >= 0) scrollerRef.value?.scrollToItem(index, { behavior: 'smooth' });
  };
  nextTick(() => {
    if (scrollerRef.value) doScroll();
    else setTimeout(doScroll, 60);
    setTimeout(() => {
      highlightedCaseId.value = null;
    }, 3000);
  });
}

onUnmounted(() => {});
defineExpose({ scrollToCase });
</script>

<template>
  <div class="flex flex-col min-h-0">
    <FilterToolbar class="mb-4 shrink-0">
      <template #start>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-muted">Group by</span>
          <USelect v-model="groupBy" :items="groupByItems" size="sm" class="w-28" aria-label="Group tests by" />
        </div>
        <span
          v-if="isLive"
          aria-live="polite"
          class="text-sm text-zinc-500 tabular-nums inline-flex items-center gap-1"
        >
          {{ finishedCount }} / {{ testCases.length }} completed <HelpHint topic="run.live" />
        </span>
        <span v-else class="text-sm text-zinc-500 tabular-nums inline-flex items-center gap-1">
          {{ visibleTestCount }}{{ visibleTestCount !== testCases.length ? ` / ${testCases.length}` : '' }} executions
          <HelpHint topic="run.test-cases" />
        </span>
      </template>

      <UInput
        v-model="testCaseSearch"
        placeholder="Search title, path, error…"
        icon="i-lucide-search"
        size="sm"
        class="min-w-48 max-sm:flex-1"
      />
      <div class="flex flex-wrap items-center gap-1">
        <button
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          :class="
            activeStatuses.includes(opt.value)
              ? opt.color === 'green'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : opt.color === 'red'
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                  : opt.color === 'orange'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          "
          :aria-pressed="activeStatuses.includes(opt.value)"
          @click="toggleStatus(opt.value)"
        >
          <span
            class="size-2 rounded-full shrink-0"
            :class="
              opt.color === 'green'
                ? 'bg-emerald-500'
                : opt.color === 'red'
                  ? 'bg-rose-500'
                  : opt.color === 'orange'
                    ? 'bg-orange-500'
                    : 'bg-zinc-400'
            "
          />
          {{ opt.label }}
        </button>
        <!-- The two signals join the status chips as toggles, not checkboxes. -->
        <button
          v-if="!isLive"
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          :class="
            showNewRegressionsOnly
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          "
          :aria-pressed="showNewRegressionsOnly"
          @click="showNewRegressionsOnly = !showNewRegressionsOnly"
        >
          <UIcon name="i-lucide-flame" class="size-3 shrink-0" />
          New regressions
        </button>
        <button
          v-if="!isLive"
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          :class="
            showNewFlakyOnly
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          "
          :aria-pressed="showNewFlakyOnly"
          @click="showNewFlakyOnly = !showNewFlakyOnly"
        >
          <UIcon name="i-lucide-shuffle" class="size-3 shrink-0" />
          Newly flaky
        </button>
      </div>
      <USelect
        v-model="testCaseBrowserFilter"
        :items="testCaseBrowserOptions"
        size="sm"
        class="w-36"
        aria-label="Filter by browser"
      />
      <USelect
        v-if="hasAnyLocks"
        v-model="testCaseLockFilter"
        :items="testCaseLockOptions"
        icon="i-lucide-lock"
        size="sm"
        class="w-36"
        aria-label="Filter by lock"
      />
      <div class="flex items-center gap-1">
        <USelect v-model="sortKey" :items="sortOptions" size="sm" class="w-36" aria-label="Sort tests by" />
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          :disabled="sortKey === 'natural'"
          :icon="sortDir === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
          :title="sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'"
          :aria-label="sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
        />
      </div>
    </FilterToolbar>

    <!-- Bulk triage bar — appears once failing rows are selected. -->
    <div
      v-if="selectionEnabled && selectedCount > 0"
      class="mb-3 shrink-0 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
    >
      <span class="text-sm font-medium" aria-live="polite">{{ selectedCount }} selected</span>
      <div class="flex flex-wrap items-center gap-2 ml-auto">
        <UButton
          size="xs"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          :loading="bulkBusy"
          @click="onBulkQuarantine"
        >
          Quarantine selected
        </UButton>
        <UDropdownMenu
          v-if="allSelectedInCluster"
          :items="[
            { label: 'Open', onSelect: () => setClusterStatus('open') },
            { label: 'Resolved', onSelect: () => setClusterStatus('resolved') },
            { label: 'Ignored', onSelect: () => setClusterStatus('ignored') },
          ]"
        >
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-triangle-alert"
            trailing-icon="i-lucide-chevron-down"
            :loading="bulkBusy"
          >
            Set cluster status…
          </UButton>
        </UDropdownMenu>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="clearSelection">Clear</UButton>
      </div>
    </div>

    <div v-if="rows.length > 0" class="flex-1 min-h-0 rounded-lg border border-default bg-default flex flex-col">
      <!-- Select-all failing, above the list (no column header to host it). -->
      <div
        v-if="selectionEnabled"
        class="flex items-center gap-2 border-b border-default bg-elevated/40 px-3 py-1.5 shrink-0"
      >
        <input
          type="checkbox"
          class="size-4 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-primary rounded"
          :checked="allSelectableSelected"
          :indeterminate.prop="someSelectableSelected"
          :aria-label="allSelectableSelected ? 'Deselect all failing tests' : 'Select all failing tests'"
          @change="toggleAll"
        />
        <span class="text-xs text-muted">Select all failing</span>
      </div>

      <ClientOnly>
        <DynamicScroller
          ref="scrollerRef"
          :items="rows"
          :min-item-size="44"
          key-field="key"
          class="flex-1 min-h-0"
          @scroll.passive="onScrollerScroll"
        >
          <template #default="{ item, index, active }">
            <DynamicScrollerItem
              :item="item"
              :active="active"
              :size-dependencies="
                item.kind === 'test'
                  ? [
                      item.tc.title,
                      item.tc.location,
                      item.tc.isNewRegression,
                      item.tc.isNewFlaky,
                      item.tc.testAnnotations,
                      item.tc.tags,
                      item.tc.locks,
                      liveStep(item.tc)?.title,
                    ]
                  : [item.label, item.count, item.triageStatus]
              "
              :data-index="index"
            >
              <TestRowGroup
                v-if="item.kind === 'group'"
                :label="item.label"
                :count="item.count"
                :open="isOpen(item.key)"
                :icon="item.icon"
                :depth="item.depth ?? 0"
                :triage-status="item.triageStatus"
                :cluster-id="item.clusterId"
                :stats="item.stats"
                :file-path="item.filePath"
                :project-key="projectKey"
                :project-name="projectName"
                @toggle="toggleGroup(item.key)"
              />
              <TestRow
                v-else
                :test-case="item.tc"
                :cluster-name="item.tc.failureClusterId != null ? clusterName(item.tc.failureClusterId) : null"
                :quarantined="isQuarantined(item.tc)"
                :selectable="selectionEnabled && isFailedStatus(item.tc.status)"
                :selected="selectedIds.has(item.tc.executionId)"
                :live-step="liveStep(item.tc)"
                :highlighted="highlightedCaseId === item.tc.executionId"
                :indent="(item.depth ?? 0) * 16"
                :project-key="projectKey"
                :project-name="projectName"
                @toggle="toggleRow(item.tc)"
              />
            </DynamicScrollerItem>
          </template>
        </DynamicScroller>

        <template #fallback>
          <div class="flex-1 min-h-0 flex items-center justify-center py-10 text-sm text-zinc-500">
            <UIcon name="i-lucide-loader-circle" class="size-4 mr-2 animate-spin" />
            Loading tests…
          </div>
        </template>
      </ClientOnly>
    </div>

    <EmptyState v-else-if="testCases.length === 0" icon="i-lucide-beaker" text="No tests recorded for this run." />

    <EmptyState v-else icon="i-lucide-search-x" text="No tests match your filters.">
      <UButton
        size="xs"
        variant="outline"
        color="neutral"
        label="Clear filters"
        @click="
          testCaseSearch = '';
          activeStatuses = [];
          testCaseBrowserFilter = 'all';
          testCaseLockFilter = 'all';
          showNewRegressionsOnly = false;
          showNewFlakyOnly = false;
        "
      />
    </EmptyState>

    <!-- Confirm quarantining a larger selection. -->
    <UModal v-model:open="quarantineConfirmOpen" title="Quarantine selected tests">
      <template #body>
        <p class="text-sm text-muted">
          This quarantines {{ selectedTestCaseIds.length }} tests. Each keeps running and reporting but is excluded from
          the CI gate's verdict until released.
        </p>
      </template>
      <template #footer>
        <div class="flex items-center gap-3 w-full justify-end">
          <UButton color="neutral" variant="ghost" :disabled="bulkBusy" @click="quarantineConfirmOpen = false">
            Cancel
          </UButton>
          <UButton color="warning" :loading="bulkBusy" @click="runBulkQuarantine">
            Quarantine {{ selectedTestCaseIds.length }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
