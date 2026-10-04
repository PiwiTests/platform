<script setup lang="ts">
/**
 * The node inspector: every immediate neighbor of the selected node as a list,
 * grouped by kind, each row with how it relates to the node (the edge kinds),
 * its worst open gap and how many tests reach it — the complete picture the
 * picture above only samples. Rows recenter the graph on click. A filter box
 * appears once the list is long enough to need one; the tests reaching the
 * node itself close the list.
 */
import { compareBySeverity, gapClassBadgeColor } from '~/utils/gap-classes';

interface GraphNode {
  kind: string;
  key: string;
  class: string | null;
  depth: number;
  tests: Array<{ testCaseId: number; title: string }>;
}
interface GraphEdge {
  fromKind: string;
  fromKey: string;
  toKind: string;
  toKey: string;
  kind: string;
  confidence: number | null;
}

const props = defineProps<{
  seed: GraphNode;
  neighbors: GraphNode[];
  edges: GraphEdge[];
  /** How a node's key is shown; a `test` endpoint shows its title rather than its id. */
  label?: (node: GraphNode) => string;
}>();
const emit = defineEmits<{ (e: 'select', node: { kind: string; key: string }): void }>();

const KIND_ORDER = ['test', 'feature', 'page', 'control', 'link', 'route', 'handler', 'dependency', 'file'];

function shown(n: GraphNode): string {
  return props.label ? props.label(n) : n.key;
}
const FILTER_THRESHOLD = 12;
/** Kinds no test "reaches": endpoints named by id, and features, which group nodes. */
const ENDPOINT_KINDS = new Set(['feature', 'test', 'commit', 'ticket', 'cluster', 'owner']);
const filter = ref('');

/** The edge kinds between the seed and a neighbor, as "← reaches" / "→ handled-by". */
function relations(n: GraphNode): string {
  const out = new Set<string>();
  for (const e of props.edges) {
    const fromSeed = e.fromKind === props.seed.kind && e.fromKey === props.seed.key;
    const toSeed = e.toKind === props.seed.kind && e.toKey === props.seed.key;
    if (fromSeed && e.toKind === n.kind && e.toKey === n.key) out.add(`→ ${e.kind}`);
    if (toSeed && e.fromKind === n.kind && e.fromKey === n.key) out.add(`${e.kind} →`);
  }
  return [...out].join(', ');
}

const groups = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const byKind = new Map<string, GraphNode[]>();
  for (const n of props.neighbors) {
    if (q && !shown(n).toLowerCase().includes(q) && !n.kind.includes(q)) continue;
    const arr = byKind.get(n.kind) ?? [];
    arr.push(n);
    byKind.set(n.kind, arr);
  }
  const order = (kind: string) => {
    const i = KIND_ORDER.indexOf(kind);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return [...byKind.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([kind, nodes]) => ({ kind, nodes: nodes.sort(compareBySeverity) }));
});
</script>

<template>
  <div class="space-y-3" data-shot="node-inspector">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-muted">
        {{ neighbors.length }} neighbor{{ neighbors.length === 1 ? '' : 's' }} of
        <span class="font-mono">{{ seed.kind }}:{{ seed.key }}</span>
      </p>
      <UInput
        v-if="neighbors.length > FILTER_THRESHOLD"
        v-model="filter"
        size="xs"
        icon="i-lucide-search"
        placeholder="Filter neighbors"
        class="w-full sm:w-56"
      />
    </div>

    <EmptyState v-if="neighbors.length === 0" icon="i-lucide-radar" text="Nothing links to this node yet" />
    <p v-else-if="groups.length === 0" class="text-xs text-muted">No neighbor matches the filter.</p>

    <div v-for="group in groups" :key="group.kind">
      <p class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
        {{ group.kind }} <span class="font-normal normal-case">({{ group.nodes.length }})</span>
      </p>
      <div class="divide-y divide-default">
        <button
          v-for="n in group.nodes"
          :key="`${n.kind}:${n.key}`"
          type="button"
          class="w-full text-left py-1.5 px-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded hover:bg-elevated/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :title="`Open ${n.kind}:${n.key} in the graph`"
          @click="emit('select', { kind: n.kind, key: n.key })"
        >
          <span class="min-w-0 basis-48 grow truncate text-sm font-mono text-highlighted">{{ shown(n) }}</span>
          <span class="text-xs text-muted">{{ relations(n) }}</span>
          <span v-if="!ENDPOINT_KINDS.has(n.kind)" class="text-xs text-muted tabular-nums"
            >{{ n.tests.length }} tests</span
          >
          <UBadge v-if="n.class" :color="gapClassBadgeColor(n.class)" variant="subtle" size="sm">{{ n.class }}</UBadge>
        </button>
      </div>
    </div>

    <div v-if="seed.tests.length > 0">
      <p class="text-xs font-medium text-muted uppercase tracking-wide mb-1">
        tests reaching this node <span class="font-normal normal-case">({{ seed.tests.length }})</span>
      </p>
      <ul class="divide-y divide-default">
        <li v-for="t in seed.tests" :key="t.testCaseId" class="py-1.5 px-1">
          <NuxtLink :to="`/test-cases/${t.testCaseId}`" class="text-sm text-primary hover:underline">{{
            t.title
          }}</NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
