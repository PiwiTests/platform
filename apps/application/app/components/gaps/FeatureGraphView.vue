<script setup lang="ts">
/**
 * The feature-graph view: a hand-drawn, layered SVG of the neighborhood around a
 * seed node. Columns are node kinds (tests → pages → controls → routes →
 * handlers → dependencies); nodes are colored by their gap class and edges by
 * their kind. Clicking a node selects it (the panel shows its gaps and tests);
 * hovering highlights the paths touching it; a depth control widens the walk.
 * Plain SVG with our own layout — no graph or charting library.
 */
import { useElementSize } from '@vueuse/core';

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
interface FeatureGraph {
  seed: { kind: string; key: string };
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const props = defineProps<{ projectId: number; seedNode: string }>();
const emit = defineEmits<{ (e: 'select', node: { kind: string; key: string }): void }>();

const depth = ref(2);
const graph = ref<FeatureGraph | null>(null);
const loading = ref(false);
const hovered = ref<string | null>(null);

// The column order the layout lays nodes out in, left to right.
const COLUMN_ORDER = ['test', 'feature', 'page', 'control', 'link', 'route', 'handler', 'dependency', 'file'];

/** Tailwind fill for a node by its gap class; no gap reads as protected. */
function classFill(cls: string | null): string {
  switch (cls) {
    case 'unhandled':
    case 'false-comfort':
      return 'fill-red-500';
    case 'degraded':
    case 'blind-spot':
      return 'fill-amber-500';
    case 'fragile':
      return 'fill-orange-400';
    default:
      return 'fill-emerald-500';
  }
}

/** Tailwind stroke for an edge by its kind. */
function edgeStroke(kind: string): string {
  switch (kind) {
    case 'reaches':
      return 'stroke-emerald-400';
    case 'checks':
      return 'stroke-blue-400';
    case 'triggers':
    case 'loads':
      return 'stroke-violet-400';
    case 'handled-by':
    case 'calls':
      return 'stroke-slate-400';
    default:
      return 'stroke-gray-300 dark:stroke-gray-600';
  }
}

async function load() {
  loading.value = true;
  try {
    graph.value = await $fetch<FeatureGraph>(`/api/projects/${props.projectId}/graph` as `/api/projects/:id/graph`, {
      query: { node: props.seedNode, depth: depth.value },
    });
  } catch {
    graph.value = null;
  } finally {
    loading.value = false;
  }
}

watch([() => props.seedNode, () => props.projectId, depth], load, { immediate: true });

const wrapper = ref<HTMLElement | null>(null);
const { width } = useElementSize(wrapper);

const COL_W = 190;
const ROW_H = 44;
const NODE_W = 150;
const NODE_H = 26;

/** Node id → laid-out position, one column per kind, stacked within a column. */
const layout = computed(() => {
  const g = graph.value;
  if (!g) return { positions: new Map<string, { x: number; y: number; node: GraphNode }>(), width: 0, height: 0 };
  const byColumn = new Map<number, GraphNode[]>();
  const colIndex = (kind: string) => {
    const i = COLUMN_ORDER.indexOf(kind);
    return i < 0 ? COLUMN_ORDER.length : i;
  };
  const usedCols = [...new Set(g.nodes.map((n) => colIndex(n.kind)))].sort((a, b) => a - b);
  const colSlot = new Map<number, number>(usedCols.map((c, i) => [c, i]));
  for (const n of g.nodes) {
    const c = colIndex(n.kind);
    const arr = byColumn.get(c) ?? [];
    arr.push(n);
    byColumn.set(c, arr);
  }
  const positions = new Map<string, { x: number; y: number; node: GraphNode }>();
  let maxRows = 0;
  for (const [col, nodes] of byColumn) {
    nodes.sort((a, b) => a.key.localeCompare(b.key));
    maxRows = Math.max(maxRows, nodes.length);
    const slot = colSlot.get(col) ?? 0;
    nodes.forEach((n, row) => {
      positions.set(`${n.kind}\x00${n.key}`, { x: slot * COL_W + 10, y: row * ROW_H + 10, node: n });
    });
  }
  return {
    positions,
    width: colSlot.size * COL_W + 20,
    height: maxRows * ROW_H + 20,
  };
});

/** Node ids highlighted for the current hover (the hovered node and its neighbors). */
const highlighted = computed(() => {
  const set = new Set<string>();
  if (!hovered.value || !graph.value) return set;
  set.add(hovered.value);
  for (const e of graph.value.edges) {
    const from = `${e.fromKind}\x00${e.fromKey}`;
    const to = `${e.toKind}\x00${e.toKey}`;
    if (from === hovered.value) set.add(to);
    if (to === hovered.value) set.add(from);
  }
  return set;
});

function nodeId(kind: string, key: string): string {
  return `${kind}\x00${key}`;
}
function shortKey(key: string): string {
  return key.length > 20 ? `${key.slice(0, 19)}…` : key;
}
</script>

<template>
  <div ref="wrapper" class="w-full">
    <div class="mb-3 flex flex-wrap items-center gap-3">
      <span class="text-xs font-medium text-muted">Depth</span>
      <USelect
        v-model="depth"
        :items="[1, 2, 3, 4, 5, 6].map((d) => ({ label: String(d), value: d }))"
        size="xs"
        class="w-20"
      />
      <span class="text-xs text-muted"
        >Nodes colored by gap class · edges by kind · click a node for its gaps and tests</span
      >
    </div>

    <LoadingState v-if="loading && !graph" />
    <EmptyState v-else-if="!graph || graph.nodes.length === 0" icon="i-lucide-radar" text="No graph for this node" />
    <div v-else class="overflow-x-auto">
      <svg
        :width="Math.max(layout.width, width)"
        :height="layout.height"
        :viewBox="`0 0 ${Math.max(layout.width, width)} ${layout.height}`"
        class="block"
      >
        <!-- Edges first, so nodes sit on top. -->
        <g>
          <line
            v-for="(e, i) in graph.edges"
            :key="`e${i}`"
            :x1="(layout.positions.get(nodeId(e.fromKind, e.fromKey))?.x ?? 0) + NODE_W"
            :y1="(layout.positions.get(nodeId(e.fromKind, e.fromKey))?.y ?? 0) + NODE_H / 2"
            :x2="layout.positions.get(nodeId(e.toKind, e.toKey))?.x ?? 0"
            :y2="(layout.positions.get(nodeId(e.toKind, e.toKey))?.y ?? 0) + NODE_H / 2"
            :class="edgeStroke(e.kind)"
            :stroke-width="1.5"
            :opacity="
              hovered && !(highlighted.has(nodeId(e.fromKind, e.fromKey)) && highlighted.has(nodeId(e.toKind, e.toKey)))
                ? 0.15
                : 0.7
            "
          />
        </g>
        <!-- Nodes. -->
        <g v-for="[id, pos] in layout.positions" :key="id">
          <g
            :transform="`translate(${pos.x},${pos.y})`"
            class="cursor-pointer"
            :opacity="hovered && !highlighted.has(id) ? 0.3 : 1"
            @click="emit('select', { kind: pos.node.kind, key: pos.node.key })"
            @mouseenter="hovered = id"
            @mouseleave="hovered = null"
          >
            <rect
              :width="NODE_W"
              :height="NODE_H"
              rx="4"
              class="stroke-gray-300 dark:stroke-gray-600"
              :class="[classFill(pos.node.class), 'opacity-90']"
            />
            <text :x="8" :y="NODE_H / 2" dominant-baseline="middle" class="fill-white text-[10px] font-medium">
              {{ pos.node.kind }}: {{ shortKey(pos.node.key) }}
            </text>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>
