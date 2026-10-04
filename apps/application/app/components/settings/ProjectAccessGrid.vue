<script setup lang="ts">
/**
 * The permission grid: a row per user, grouped by role, and a column per
 * project after an All projects column. Each cell toggles one user's access to
 * one project — the page saves the change; this component renders and reports
 * clicks. Hovering or focusing a cell highlights its whole row and column, so a
 * cell deep in a wide grid still reads against its user and its project. Tab
 * enters and leaves the grid as a single stop; the arrow keys, Home and End move
 * between cells.
 */
import { Role } from '#shared/types';
import {
  groupProjectAccessUsers,
  projectAccessCellKey,
  projectAccessCellState,
  projectAccessProjectName,
  projectAccessUserName,
  type ProjectAccessCellState,
  type ProjectAccessProject,
  type ProjectAccessUser,
} from '#shared/project-access';

const props = defineProps<{
  users: ProjectAccessUser[];
  projects: ProjectAccessProject[];
  /** Cells whose change is being saved, keyed by `projectAccessCellKey`. */
  saving: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  toggle: [userId: number, projectId: number | null, granted: boolean];
}>();

interface GridColumn {
  /** `all`, or the project id — the value of the column's `data-col`. */
  key: string;
  projectId: number | null;
  label: string;
  /** Header tooltip: the label and, when it differs, the project key. */
  title: string;
}

const columns = computed<GridColumn[]>(() => [
  { key: 'all', projectId: null, label: 'All projects', title: 'All projects, including ones created later' },
  ...props.projects.map((project) => ({
    key: String(project.id),
    projectId: project.id,
    label: projectAccessProjectName(project),
    title: project.label && project.label !== project.name ? `${project.label} (${project.name})` : project.name,
  })),
]);

/** What a tick grants each role, shown on the role's group row. */
const ROLE_GROUPS: Record<string, { label: string; meaning: string }> = {
  [Role.ADMINISTRATOR]: { label: 'Administrators', meaning: 'every project' },
  [Role.REPORTER]: { label: 'Reporters', meaning: 'upload and triage' },
  [Role.USER]: { label: 'Users', meaning: 'read-only' },
};

function roleGroup(role: Role) {
  return ROLE_GROUPS[role] ?? { label: role, meaning: '' };
}

const groups = computed(() => groupProjectAccessUsers(props.users));
/** Users in display order; a cell's row index is its user's position here. */
const rowIndex = computed(() => new Map(groups.value.flatMap((group) => group.users).map((user, i) => [user.id, i])));

// ── Crosshair: the row and column of the hovered or focused cell ──────────
const crosshair = reactive<{ row: number | null; col: string | null }>({ row: null, col: null });

/** Cells carry `data-row` (user id) and `data-col` (column key); headers carry one of the two. */
function trackCrosshair(event: Event) {
  const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row], [data-col]');
  crosshair.row = cell?.dataset.row ? Number(cell.dataset.row) : null;
  crosshair.col = cell?.dataset.col ?? null;
}

function clearCrosshair() {
  crosshair.row = null;
  crosshair.col = null;
}

function onFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) clearCrosshair();
}

function cellHighlight(userId: number, colKey: string): string {
  const inRow = crosshair.row === userId;
  const inCol = crosshair.col === colKey;
  if (inRow && inCol) return 'bg-accented';
  return inRow || inCol ? 'bg-elevated' : '';
}

// ── Keyboard: one tab stop, arrow keys between cells ─────────────────────
const gridEl = useTemplateRef<HTMLElement>('grid');
const active = reactive({ row: 0, col: 0 });

watch([() => rowIndex.value.size, () => columns.value.length], ([rowCount, colCount]) => {
  active.row = Math.min(active.row, Math.max(rowCount - 1, 0));
  active.col = Math.min(active.col, Math.max(colCount - 1, 0));
});

const KEY_MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function onCellKeydown(event: KeyboardEvent, row: number, col: number) {
  const move = KEY_MOVES[event.key];
  let target: [number, number] | null = null;
  if (move) target = [row + move[0], col + move[1]];
  else if (event.key === 'Home') target = [row, 0];
  else if (event.key === 'End') target = [row, columns.value.length - 1];
  if (!target) return;
  event.preventDefault();
  const nextRow = Math.min(Math.max(target[0], 0), rowIndex.value.size - 1);
  const nextCol = Math.min(Math.max(target[1], 0), columns.value.length - 1);
  gridEl.value?.querySelector<HTMLElement>(`[data-pos="${nextRow}:${nextCol}"]`)?.focus();
}

function onCellFocus(row: number, col: number) {
  active.row = row;
  active.col = col;
}

// ── Cells ────────────────────────────────────────────────────────────────
const GLYPH_CLASS: Record<ProjectAccessCellState, string> = {
  granted: 'border-primary bg-primary text-inverted',
  none: 'border-accented bg-default',
  inherited: 'border-transparent bg-primary/15 text-primary',
  admin: 'border-transparent text-muted',
};

const LEGEND: { state: ProjectAccessCellState; label: string }[] = [
  { state: 'granted', label: 'Can open' },
  { state: 'none', label: 'Cannot open' },
  { state: 'inherited', label: 'Through All projects' },
  { state: 'admin', label: 'Administrator' },
];

interface GridCell {
  column: GridColumn;
  /** Column index, for keyboard moves. */
  col: number;
  state: ProjectAccessCellState;
  /** Administrators and cells covered by All projects cannot be toggled. */
  locked: boolean;
  saving: boolean;
}

function rowCells(user: ProjectAccessUser): GridCell[] {
  return columns.value.map((column, col) => {
    const state = projectAccessCellState(user, column.projectId);
    return {
      column,
      col,
      state,
      locked: state === 'admin' || state === 'inherited',
      saving: props.saving.has(projectAccessCellKey(user.id, column.projectId)),
    };
  });
}

function cellTitle(user: ProjectAccessUser, column: GridColumn, state: ProjectAccessCellState): string {
  const name = projectAccessUserName(user);
  if (state === 'admin') return `${name} is an administrator and opens every project`;
  if (state === 'inherited') {
    return `${name} opens ${column.label} through All projects — untick All projects to choose projects one by one`;
  }
  if (column.projectId === null) {
    return state === 'granted'
      ? `${name} opens every project, including ones created later — click to revoke`
      : `Grant ${name} every project, including ones created later`;
  }
  return state === 'granted' ? `${name} opens ${column.label} — click to revoke` : `Grant ${name} ${column.label}`;
}

function toggle(user: ProjectAccessUser, cell: GridCell) {
  if (cell.locked || cell.saving) return;
  emit('toggle', user.id, cell.column.projectId, cell.state !== 'granted');
}

function accessSummary(user: ProjectAccessUser): string {
  if (user.role === Role.ADMINISTRATOR) return '';
  if (user.global) return 'all projects';
  const count = user.projectIds.length;
  if (count === 0) return 'no projects';
  return `${count} ${count === 1 ? 'project' : 'projects'}`;
}

function userMeta(user: ProjectAccessUser): string {
  return [user.name ? `@${user.username}` : '', accessSummary(user)].filter(Boolean).join(' · ');
}
</script>

<template>
  <div>
    <!-- Scrolls both ways inside the card from `sm` up, so the header row and the
         user column stay pinned; on a phone it only scrolls sideways and the page
         scrolls as one document. -->
    <div
      ref="grid"
      class="max-w-full overflow-auto sm:max-h-[70vh]"
      @mouseover="trackCrosshair"
      @mouseleave="clearCrosshair"
      @focusin="trackCrosshair"
      @focusout="onFocusOut"
    >
      <table class="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              class="sticky left-0 top-0 z-30 border-b border-default bg-default px-3 pb-2 text-left align-bottom"
            >
              <span class="text-xs font-medium text-muted">User</span>
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :data-col="column.key"
              :title="column.title"
              class="sticky top-0 z-20 w-10 min-w-10 border-b border-default px-0 pb-2 pt-3 align-bottom"
              :class="[
                crosshair.col === column.key ? 'bg-elevated text-highlighted' : 'bg-default text-muted',
                { 'border-r': column.projectId === null },
              ]"
            >
              <!-- Physical `ml-auto mr-auto`: `mx-auto` is margin-inline, which a vertical
                   label resolves to its top and bottom, leaving it flush left. -->
              <span
                class="ml-auto mr-auto block max-h-32 truncate text-xs font-medium [writing-mode:vertical-rl] rotate-180"
                >{{ column.label }}</span
              >
            </th>
          </tr>
        </thead>
        <tbody v-for="group in groups" :key="group.role">
          <!-- The group label sits in the pinned user column; the empty cells keep
               the highlighted column and the All projects divider unbroken. -->
          <tr>
            <th
              scope="rowgroup"
              class="sticky left-0 z-10 bg-default px-3 pb-1 pt-4 text-left align-bottom text-xs font-normal text-muted"
            >
              <span class="font-medium">{{ roleGroup(group.role).label }}</span>
              <template v-if="roleGroup(group.role).meaning"> · {{ roleGroup(group.role).meaning }}</template>
            </th>
            <td
              v-for="column in columns"
              :key="column.key"
              :data-col="column.key"
              :class="[crosshair.col === column.key ? 'bg-elevated' : '', { 'border-r': column.projectId === null }]"
              class="border-default"
            />
          </tr>
          <tr v-for="user in group.users" :key="user.id">
            <th
              scope="row"
              :data-row="user.id"
              class="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-b border-default px-3 py-1.5 text-left font-normal sm:w-56 sm:min-w-56 sm:max-w-56"
              :class="crosshair.row === user.id ? 'bg-elevated' : 'bg-default'"
            >
              <!-- Wraps on a phone, where a truncated name has no tooltip to recover it. -->
              <span
                class="block break-words text-sm text-highlighted sm:truncate"
                :title="projectAccessUserName(user)"
                >{{ projectAccessUserName(user) }}</span
              >
              <span
                v-if="userMeta(user)"
                class="block break-words text-xs text-muted sm:truncate"
                :title="userMeta(user)"
                >{{ userMeta(user) }}</span
              >
            </th>
            <td
              v-for="cell in rowCells(user)"
              :key="cell.column.key"
              :data-row="user.id"
              :data-col="cell.column.key"
              class="border-b border-default p-0 text-center"
              :class="[cellHighlight(user.id, cell.column.key), { 'border-r': cell.column.projectId === null }]"
            >
              <button
                type="button"
                role="checkbox"
                :data-pos="`${rowIndex.get(user.id)}:${cell.col}`"
                :tabindex="active.row === rowIndex.get(user.id) && active.col === cell.col ? 0 : -1"
                :aria-checked="cell.state !== 'none'"
                :aria-disabled="cell.locked || cell.saving"
                :aria-label="`${projectAccessUserName(user)} — ${cell.column.label}`"
                :title="cellTitle(user, cell.column, cell.state)"
                class="inline-flex size-5 scroll-ml-44 scroll-mt-40 items-center justify-center rounded border align-middle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:scroll-ml-60"
                :class="[
                  GLYPH_CLASS[cell.state],
                  cell.locked ? 'cursor-default' : 'cursor-pointer hover:border-primary',
                  { 'opacity-60': cell.saving },
                ]"
                @click="toggle(user, cell)"
                @focus="onCellFocus(rowIndex.get(user.id) ?? 0, cell.col)"
                @keydown="onCellKeydown($event, rowIndex.get(user.id) ?? 0, cell.col)"
              >
                <UIcon v-if="cell.state !== 'none'" name="i-lucide-check" class="size-3.5" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span v-for="item in LEGEND" :key="item.state" class="inline-flex items-center gap-1.5">
        <span class="inline-flex size-4 items-center justify-center rounded border" :class="GLYPH_CLASS[item.state]">
          <UIcon v-if="item.state !== 'none'" name="i-lucide-check" class="size-3" />
        </span>
        {{ item.label }}
      </span>
    </div>
  </div>
</template>
