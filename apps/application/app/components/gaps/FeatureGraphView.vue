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

// A monotonic token so an out-of-order response (a slow depth-6 walk landing
// after a newer depth-2 one) never overwrites the current graph.
let requestToken = 0;

async function load() {
  const token = ++requestToken;
  loading.value = true;
  try {
    const result = await $fetch<FeatureGraph>(`/api/projects/${props.projectId}/graph` as `/api/projects/:id/graph`, {
      query: { node: props.seedNode, depth: depth.value },
    });
    if (token !== requestToken) return; // superseded by a newer request
    graph.value = result;
  } catch {
    if (token === requestToken) graph.value = null;
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

watch([() => props.seedNode, () => props.projectId, depth], load, { immediate: true });

const wrapper = ref<HTMLElement | null>(null);
const { width } = useElementSize(wrapper);

const COL_W = 190;
const ROW_H = 44;
const NODE_W = 150;
const NODE_H = 26;
/** The most nodes drawn in one column; the rest collapse into a "+N more" marker. */
const MAX_ROWS_PER_COLUMN = 40;

interface OverflowMarker {
  x: number;
  y: number;
  count: number;
}

/**
 * Node id → laid-out position, one column per kind, stacked within a column. Each
 * column is capped at {@link MAX_ROWS_PER_COLUMN} nodes (sorted by depth then
 * key) with the remainder collapsed into a "+N more" marker, so a hub node cannot
 * grow the SVG without bound — the server caps only the per-level frontier.
 */
const layout = computed(() => {
  const g = graph.value;
  const empty = {
    positions: new Map<string, { x: number; y: number; node: GraphNode }>(),
    overflow: [] as OverflowMarker[],
    width: 0,
    height: 0,
  };
  if (!g) return empty;
  const byColumn = new Map<number, GraphNode[]>();
  const colIndex = (kind: string) => {
    const i = COLUMN_ORDER.indexOf(kind);
    return i < 0 ? COLUMN_ORDER.length : i;
  };
  for (const n of g.nodes) {
    const c = colIndex(n.kind);
    const arr = byColumn.get(c) ?? [];
    arr.push(n);
    byColumn.set(c, arr);
  }
  const usedCols = [...byColumn.keys()].sort((a, b) => a - b);
  const colSlot = new Map<number, number>(usedCols.map((c, i) => [c, i]));
  const positions = new Map<string, { x: number; y: number; node: GraphNode }>();
  const overflow: OverflowMarker[] = [];
  let maxRows = 0;
  for (const [col, nodes] of byColumn) {
    nodes.sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
    const slot = colSlot.get(col) ?? 0;
    const shown = nodes.slice(0, MAX_ROWS_PER_COLUMN);
    shown.forEach((n, row) => {
      positions.set(`${n.kind}\x00${n.key}`, { x: slot * COL_W + 10, y: row * ROW_H + 10, node: n });
    });
    let rows = shown.length;
    if (nodes.length > MAX_ROWS_PER_COLUMN) {
      overflow.push({ x: slot * COL_W + 10, y: shown.length * ROW_H + 10, count: nodes.length - MAX_ROWS_PER_COLUMN });
      rows += 1;
    }
    maxRows = Math.max(maxRows, rows);
  }
  return {
    positions,
    overflow,
    width: colSlot.size * COL_W + 20,
    height: maxRows * ROW_H + 20,
  };
});

/** Edges with both endpoints drawn — never a line to a collapsed or absent node. */
const drawnEdges = computed(() => {
  const g = graph.value;
  if (!g) return [];
  const pos = layout.value.positions;
  return g.edges.filter((e) => pos.has(nodeId(e.fromKind, e.fromKey)) && pos.has(nodeId(e.toKind, e.toKey)));
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

/** The full key plus the tests that reach the node — the SVG title and aria-label. */
function nodeTitle(node: GraphNode): string {
  const head = `${node.kind}: ${node.key}`;
  if (node.tests.length === 0) return head;
  const shown = node.tests.slice(0, 10).map((t) => `• ${t.title}`);
  const more = node.tests.length > 10 ? `\n…and ${node.tests.length - 10} more` : '';
  return `${head}\nReached by ${node.tests.length} test${node.tests.length === 1 ? '' : 's'}:\n${shown.join('\n')}${more}`;
}
</script>

<template>
  <div ref="wrapper" class="w-full" data-shot="feature-graph">
    <div class="mb-3 flex flex-wrap items-center gap-3">
      <span class="text-xs font-medium text-muted">Depth</span>
      <USelect
        v-model="depth"
        :items="[1, 2, 3, 4, 5, 6].map((d) => ({ label: String(d), value: d }))"
        size="xs"
        class="w-20"
      />
      <span class="text-xs text-muted"
        >Nodes colored by gap class · edges by kind · hover a node for the tests that reach it · click to recenter</span
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
        <!-- Edges first, so nodes sit on top. Only edges between drawn nodes. -->
        <g>
          <line
            v-for="(e, i) in drawnEdges"
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
            class="cursor-pointer focus:outline-none"
            role="button"
            tabindex="0"
            :aria-label="nodeTitle(pos.node)"
            :opacity="hovered && !highlighted.has(id) ? 0.3 : 1"
            @click="emit('select', { kind: pos.node.kind, key: pos.node.key })"
            @keydown.enter.prevent="emit('select', { kind: pos.node.kind, key: pos.node.key })"
            @keydown.space.prevent="emit('select', { kind: pos.node.kind, key: pos.node.key })"
            @mouseenter="hovered = id"
            @mouseleave="hovered = null"
            @focus="hovered = id"
            @blur="hovered = null"
          >
            <title>{{ nodeTitle(pos.node) }}</title>
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
            <!-- Count of tests reaching this node. -->
            <g v-if="pos.node.tests.length > 0">
              <circle :cx="NODE_W - 11" :cy="NODE_H / 2" r="8" class="fill-slate-900/70" />
              <text
                :x="NODE_W - 11"
                :y="NODE_H / 2"
                text-anchor="middle"
                dominant-baseline="central"
                class="fill-white text-[9px] font-semibold"
              >
                {{ pos.node.tests.length > 99 ? '99+' : pos.node.tests.length }}
              </text>
            </g>
          </g>
        </g>
        <!-- Per-column overflow markers for nodes beyond the row cap. -->
        <g v-for="(o, i) in layout.overflow" :key="`o${i}`" :transform="`translate(${o.x},${o.y})`">
          <rect
            :width="NODE_W"
            :height="NODE_H"
            rx="4"
            class="fill-gray-200 stroke-gray-300 dark:fill-gray-700 dark:stroke-gray-600"
          />
          <text :x="8" :y="NODE_H / 2" dominant-baseline="middle" class="fill-gray-600 dark:fill-gray-300 text-[10px]">
            +{{ o.count }} more
          </text>
        </g>
      </svg>
    </div>
  </div>
</template>
