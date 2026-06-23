<script setup lang="ts">
import { ref, computed } from 'vue';
import type { TestCaseResult, SuiteInfo } from '~~/types/api';

const props = defineProps<{
  testCases: TestCaseResult[];
  suites: SuiteInfo[];
  hasFilter: boolean;
  highlightedCaseId?: number | null;
}>();

const suiteLookup = computed(() => {
  const map = new Map<string, { mode: string; annotations: Array<{ type: string; description?: string }> }>();
  for (const s of props.suites) {
    map.set(`${s.filePath}\x1f${s.suitePath.join('\x1f')}`, s);
  }
  return map;
});

interface Stats {
  passed: number;
  failed: number;
  skipped: number;
  didnotrun: number;
  running: number;
  total: number;
}

interface GroupRow {
  kind: 'group';
  depth: number;
  key: string;
  label: string;
  stats: Stats;
  mode?: 'parallel' | 'serial' | 'default';
  annotations?: Array<{ type: string; description?: string }>;
}

interface TestRow {
  kind: 'test';
  depth: number;
  key: string;
  test: TestCaseResult;
}

type FlatRow = GroupRow | TestRow;

function normalizeStatus(s: string): string {
  return s === 'timedOut' || s === 'timedout' ? 'failed' : s;
}

function annotationColor(type: string): 'warning' | 'error' | 'neutral' | 'info' | 'primary' {
  if (type === 'fixme' || type === 'slow') return 'warning';
  if (type === 'fail') return 'error';
  if (type === 'skip') return 'neutral';
  if (type === 'tag') return 'primary';
  return 'info';
}

function annotationIcon(type: string): string | null {
  switch (type) {
    case 'fixme':
      return 'i-lucide-wrench';
    case 'skip':
      return 'i-lucide-skip-forward';
    case 'slow':
      return 'i-lucide-timer';
    case 'fail':
      return 'i-lucide-x-circle';
    case 'tag':
      return 'i-lucide-tag';
    default:
      return null;
  }
}

function annotationLabel(ann: { type: string; description?: string }): string {
  return ann.type === 'tag' ? (ann.description ?? ann.type) : ann.type;
}

function computeStats(tests: TestCaseResult[]): Stats {
  const stats: Stats = { passed: 0, failed: 0, skipped: 0, didnotrun: 0, running: 0, total: 0 };
  for (const t of tests) {
    const s = normalizeStatus(t.status) as keyof Stats;
    if (s in stats) (stats[s] as number)++;
    stats.total++;
  }
  return stats;
}

// Set of collapsed group keys. Everything starts expanded (empty = nothing collapsed).
const collapsedKeys = ref(new Set<string>());

const isAllExpanded = computed(() => collapsedKeys.value.size === 0);

function isExpanded(key: string): boolean {
  if (props.hasFilter) return true;
  return !collapsedKeys.value.has(key);
}

function toggleGroup(key: string): void {
  if (props.hasFilter) return;
  const next = new Set(collapsedKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsedKeys.value = next;
}

function computeAllGroupKeys(): string[] {
  const keys: string[] = [];
  const byFile = new Map<string, TestCaseResult[]>();
  for (const t of props.testCases) {
    const fp = t.filePath ?? 'unknown';
    if (!byFile.has(fp)) byFile.set(fp, []);
    byFile.get(fp)!.push(t);
  }
  for (const [filePath, fileTests] of byFile) {
    keys.push(`file:${filePath}`);
    const suiteKeys = new Set<string>();
    for (const t of fileTests) {
      const sp = t.suitePath ?? [];
      for (let i = 1; i <= sp.length; i++) {
        suiteKeys.add(`group:${filePath}\x1f${sp.slice(0, i).join('\x1f')}`);
      }
    }
    for (const k of suiteKeys) keys.push(k);
  }
  return keys;
}

function collapseAll(): void {
  collapsedKeys.value = new Set(computeAllGroupKeys());
}

function expandAll(): void {
  collapsedKeys.value = new Set();
}

function addLevel(
  rows: FlatRow[],
  tests: TestCaseResult[],
  filePath: string,
  parentSuite: string[],
  depth: number,
): void {
  const direct = tests.filter((t) => (t.suitePath ?? []).length === parentSuite.length);
  const nested = tests.filter((t) => (t.suitePath ?? []).length > parentSuite.length);

  const groups = new Map<string, TestCaseResult[]>();
  for (const t of nested) {
    const seg = (t.suitePath ?? [])[parentSuite.length]!;
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg)!.push(t);
  }

  for (const [seg, groupTests] of groups) {
    const groupPath = [...parentSuite, seg];
    const groupKey = `group:${filePath}\x1f${groupPath.join('\x1f')}`;
    const suiteEntry = suiteLookup.value.get(`${filePath}\x1f${groupPath.join('\x1f')}`);

    rows.push({
      kind: 'group',
      depth,
      key: groupKey,
      label: seg,
      stats: computeStats(groupTests),
      mode: (suiteEntry?.mode as 'parallel' | 'serial' | 'default') ?? 'default',
      annotations: suiteEntry?.annotations ?? [],
    });

    if (isExpanded(groupKey)) {
      addLevel(rows, groupTests, filePath, groupPath, depth + 1);
    }
  }

  for (const test of direct) {
    rows.push({ kind: 'test', depth, key: `test:${test.id}`, test });
  }
}

const flatRows = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = [];

  const byFile = new Map<string, TestCaseResult[]>();
  for (const test of props.testCases) {
    const fp = test.filePath ?? 'unknown';
    if (!byFile.has(fp)) byFile.set(fp, []);
    byFile.get(fp)!.push(test);
  }

  for (const [filePath, fileTests] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fileKey = `file:${filePath}`;
    rows.push({ kind: 'group', depth: 0, key: fileKey, label: filePath, stats: computeStats(fileTests) });
    if (isExpanded(fileKey)) {
      addLevel(rows, fileTests, filePath, [], 1);
    }
  }

  return rows;
});
</script>

<template>
  <div class="rounded-lg border border-default text-sm flex flex-col flex-1 min-h-0">
    <!-- Toolbar: collapse/expand all -->
    <div class="flex items-center justify-end px-3 py-1.5 border-b border-default bg-elevated shrink-0">
      <button
        class="flex items-center gap-1 text-xs transition-colors"
        :class="hasFilter ? 'text-muted cursor-not-allowed opacity-50' : 'text-muted hover:text-default'"
        :disabled="hasFilter"
        :title="hasFilter ? 'Clear filters to collapse/expand' : isAllExpanded ? 'Collapse all' : 'Expand all'"
        @click="isAllExpanded ? collapseAll() : expandAll()"
      >
        <UIcon :name="isAllExpanded ? 'i-lucide-fold-vertical' : 'i-lucide-unfold-vertical'" class="size-3.5" />
        {{ isAllExpanded ? 'Collapse all' : 'Expand all' }}
      </button>
    </div>

    <!-- Scrollable tree body -->
    <div class="overflow-y-auto flex-1 min-h-0">
      <template v-for="row in flatRows" :key="row.key">
        <!-- Group row (file or describe) — sticky within the scroll container -->
        <div
          v-if="row.kind === 'group'"
          class="flex items-center gap-2 py-2 pr-4 border-b border-default last:border-b-0 select-none sticky"
          :class="[row.depth === 0 ? 'bg-elevated' : 'bg-default', !hasFilter && 'cursor-pointer']"
          :style="{
            paddingLeft: `${row.depth * 20 + 12}px`,
            top: `${row.depth * 36}px`,
            zIndex: 20 - row.depth,
          }"
          @click="toggleGroup(row.key)"
        >
          <UIcon
            :name="isExpanded(row.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5 text-muted shrink-0"
          />
          <UIcon
            :name="row.depth === 0 ? 'i-lucide-file-code-2' : 'i-lucide-folder-open'"
            class="size-4 shrink-0"
            :class="row.depth === 0 ? 'text-blue-500' : 'text-amber-500'"
          />
          <span class="font-medium truncate min-w-0" :class="row.depth === 0 ? 'text-default' : 'text-muted'">
            {{ row.label }}
          </span>
          <div v-if="row.depth > 0" class="flex items-center gap-1 shrink-0">
            <UBadge v-if="row.mode === 'parallel'" color="success" variant="soft" size="xs">parallel</UBadge>
            <UBadge v-if="row.mode === 'serial'" color="warning" variant="soft" size="xs">serial</UBadge>
            <UBadge
              v-for="ann in row.annotations"
              :key="`${ann.type}:${ann.description ?? ''}`"
              :color="annotationColor(ann.type)"
              variant="soft"
              size="xs"
              :title="ann.type !== 'tag' ? (ann.description ?? undefined) : undefined"
              class="gap-1"
            >
              <UIcon v-if="annotationIcon(ann.type)" :name="annotationIcon(ann.type)!" class="size-2.5 shrink-0" />
              {{ annotationLabel(ann) }}
            </UBadge>
          </div>
          <div class="flex-1" />
          <div class="flex items-center gap-2 shrink-0 tabular-nums">
            <span v-if="row.stats.failed > 0" class="text-xs text-red-600 dark:text-red-400 font-medium">
              {{ row.stats.failed }} failed
            </span>
            <span v-if="row.stats.passed > 0" class="text-xs text-green-600 dark:text-green-400">
              {{ row.stats.passed }} passed
            </span>
            <span v-if="row.stats.skipped > 0" class="text-xs text-muted">{{ row.stats.skipped }} skipped</span>
            <span v-if="row.stats.didnotrun > 0" class="text-xs text-amber-600 dark:text-amber-400">
              {{ row.stats.didnotrun }} didn't run
            </span>
            <span v-if="row.stats.running > 0" class="text-xs text-info">{{ row.stats.running }} running</span>
          </div>
        </div>

        <!-- Test row -->
        <div
          v-else
          class="flex items-center gap-2 pr-3 py-1.5 border-b border-default last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors"
          :class="highlightedCaseId === row.test.id ? 'animate-pulse bg-yellow-100 dark:bg-yellow-900/30' : ''"
          :style="{ paddingLeft: `${row.depth * 20 + 12}px` }"
        >
          <UIcon name="i-lucide-flask-conical" class="size-3.5 text-muted shrink-0" />
          <UBadge
            :color="
              getStatusColor(
                row.test.status === 'timedOut' || row.test.status === 'timedout' ? 'failed' : row.test.status,
              )
            "
            size="xs"
            class="capitalize shrink-0"
          >
            {{ formatStatusLabel(row.test.status) }}
          </UBadge>
          <UBadge
            v-for="ann in row.test.testAnnotations ?? []"
            :key="`${ann.type}:${ann.description ?? ''}`"
            :color="annotationColor(ann.type)"
            variant="soft"
            size="xs"
            :title="ann.type !== 'tag' ? (ann.description ?? undefined) : undefined"
            class="shrink-0 gap-1"
          >
            <UIcon v-if="annotationIcon(ann.type)" :name="annotationIcon(ann.type)!" class="size-2.5 shrink-0" />
            {{ annotationLabel(ann) }}
          </UBadge>
          <a
            :href="`/test-run-cases/${row.test.id}`"
            class="text-primary hover:underline truncate flex-1 min-w-0"
            @click.prevent="navigateTo(`/test-run-cases/${row.test.id}`)"
          >
            {{ row.test.title }}
          </a>
          <div class="flex items-center gap-2 shrink-0">
            <span v-if="row.test.status === 'running'" class="text-xs text-info">In progress...</span>
            <span v-else-if="row.test.duration" class="text-xs text-muted tabular-nums">
              {{ formatDuration(row.test.duration) }}
            </span>
            <UBadge
              v-if="row.test.workerIndex != null"
              color="neutral"
              variant="soft"
              size="xs"
              class="font-mono"
              :title="`Worker ${row.test.workerIndex}`"
            >
              w{{ row.test.workerIndex }}
            </UBadge>
            <UBadge v-if="(row.test.retries ?? 0) > 0" color="warning" variant="soft" size="xs">
              {{ row.test.retries }}x
            </UBadge>
            <UButton :to="`/test-run-cases/${row.test.id}`" size="xs" variant="outline"> View </UButton>
          </div>
        </div>
      </template>

      <div v-if="flatRows.length === 0" class="text-center py-8 text-muted">
        <UIcon name="i-lucide-search-x" class="size-6 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
        <p class="text-sm">No test cases match your filters.</p>
      </div>
    </div>
  </div>
</template>
