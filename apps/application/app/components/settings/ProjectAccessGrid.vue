<script setup lang="ts">
/**
 * The permission grid: a row per group, then a row per user, and a column per
 * project after an All projects column. Each cell shows the role its row holds
 * there and opens a role menu; the page saves the change, this component
 * renders and reports picks. A role the row only holds from elsewhere (its All
 * projects role, or a group's role for a user) shows faint, its source in the
 * tooltip; administrators' rows are locked. Hovering or focusing a cell
 * highlights its whole row and column. Tab enters and leaves the grid as a
 * single stop; the arrow keys, Home and End move between cells, and Space or
 * Enter opens the focused cell's menu.
 */
import type { DropdownMenuItem } from '@nuxt/ui';
import {
  InstanceRole,
  PROJECT_ROLE_DESCRIPTIONS,
  PROJECT_ROLE_LABELS,
  PROJECT_ROLES,
  type ProjectRole,
} from '#shared/permissions';
import {
  accessSubjectKey,
  indexProjectAccessBindings,
  projectAccessCellKey,
  projectAccessCellState,
  projectAccessProjectName,
  type AccessSubject,
  type GroupListItem,
  type ProjectAccessCellState,
  type ProjectAccessProject,
  type ProjectAccessRow,
  type ProjectAccessUser,
  type RoleBindingView,
} from '#shared/project-access';

const props = defineProps<{
  /** The rows to show, groups first (`projectAccessRows`, filtered). */
  rows: ProjectAccessRow[];
  projects: ProjectAccessProject[];
  /** Every user, group and binding, unfiltered: a user's cells read their groups' roles. */
  users: ProjectAccessUser[];
  groups: GroupListItem[];
  bindings: RoleBindingView[];
  /** Cells whose change is being saved, keyed by `projectAccessCellKey`. */
  saving: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  change: [subject: AccessSubject, projectId: number | null, role: ProjectRole | null];
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

const groupRows = computed(() => props.rows.filter((row) => row.subject.type === 'group'));
const userRows = computed(() => props.rows.filter((row) => row.subject.type === 'user'));
const sections = computed(() =>
  [
    { id: 'groups', label: 'Groups', rows: groupRows.value },
    { id: 'users', label: 'Users', rows: userRows.value },
  ].filter((section) => section.rows.length > 0),
);

/** Rows in display order; a cell's row index is its row's position here. */
const rowIndex = computed(
  () => new Map([...groupRows.value, ...userRows.value].map((row, i) => [accessSubjectKey(row.subject), i])),
);
const rowCount = computed(() => rowIndex.value.size);

const groupNames = computed(() => new Map(props.groups.map((group) => [group.id, group.name])));

/** Under the name: a group's member count; a user's username and groups, or Administrator. */
function rowMeta(row: ProjectAccessRow): string {
  if ('group' in row) {
    const count = row.group.memberCount;
    return `${count} ${count === 1 ? 'member' : 'members'}`;
  }
  const user = row.user;
  const parts = [user.name ? `@${user.username}` : ''];
  if (user.instanceRole === InstanceRole.ADMINISTRATOR) parts.push('Administrator');
  else
    parts.push(
      user.groupIds
        .map((id) => groupNames.value.get(id))
        .filter(Boolean)
        .join(', '),
    );
  return parts.filter(Boolean).join(' · ');
}

// ── Crosshair: the row and column of the hovered or focused cell ──────────
const crosshair = reactive<{ row: string | null; col: string | null }>({ row: null, col: null });

/** Cells carry `data-row` (subject key) and `data-col` (column key); headers carry one of the two. */
function trackCrosshair(event: Event) {
  const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row], [data-col]');
  crosshair.row = cell?.dataset.row ?? null;
  crosshair.col = cell?.dataset.col ?? null;
}

function clearCrosshair() {
  crosshair.row = null;
  crosshair.col = null;
}

function onFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) clearCrosshair();
}

function cellHighlight(rowKey: string, colKey: string): string {
  const inRow = crosshair.row === rowKey;
  const inCol = crosshair.col === colKey;
  if (inRow && inCol) return 'bg-accented';
  return inRow || inCol ? 'bg-elevated' : '';
}

// ── Keyboard: one tab stop, arrow keys between cells ─────────────────────
const gridEl = useTemplateRef<HTMLElement>('grid');
const active = reactive({ row: 0, col: 0 });

watch([rowCount, () => columns.value.length], ([rows, cols]) => {
  active.row = Math.min(active.row, Math.max(rows - 1, 0));
  active.col = Math.min(active.col, Math.max(cols - 1, 0));
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
  const nextRow = Math.min(Math.max(target[0], 0), rowCount.value - 1);
  const nextCol = Math.min(Math.max(target[1], 0), columns.value.length - 1);
  gridEl.value?.querySelector<HTMLElement>(`[data-pos="${nextRow}:${nextCol}"]`)?.focus();
}

function onCellFocus(row: number, col: number) {
  active.row = row;
  active.col = col;
}

// ── Cells ────────────────────────────────────────────────────────────────
interface GridCell {
  column: GridColumn;
  /** Column index, for keyboard moves. */
  col: number;
  state: ProjectAccessCellState;
  /** The role the cell shows: its own, else the strongest one it holds from elsewhere. */
  shown: ProjectRole | null;
  /** Administrators' cells cannot be changed. */
  locked: boolean;
  saving: boolean;
}

const index = computed(() => indexProjectAccessBindings(props.bindings));

const cellsByRow = computed(() => {
  const grid = { users: props.users, groups: props.groups, bindings: props.bindings };
  const byRow = new Map<string, GridCell[]>();
  for (const row of props.rows) {
    byRow.set(
      accessSubjectKey(row.subject),
      columns.value.map((column, col) => {
        const state = projectAccessCellState(grid, row.subject, column.projectId, index.value);
        return {
          column,
          col,
          state,
          shown: state.role ?? strongestProjectRole(state.inherited.map((i) => i.role)),
          locked: state.admin,
          saving: props.saving.has(projectAccessCellKey(row.subject, column.projectId)),
        };
      }),
    );
  }
  return byRow;
});

function cellsOf(row: ProjectAccessRow): GridCell[] {
  return cellsByRow.value.get(accessSubjectKey(row.subject)) ?? [];
}

function targetName(column: GridColumn): string {
  return column.projectId === null ? 'all projects' : column.label;
}

function cellText(cell: GridCell): string {
  if (cell.state.admin) return 'Administrator';
  return cell.shown ? PROJECT_ROLE_LABELS[cell.shown] : '—';
}

function cellClass(cell: GridCell): string {
  if (cell.state.admin) return 'text-muted cursor-default';
  if (cell.state.role) return 'font-medium text-highlighted cursor-pointer';
  return 'text-muted cursor-pointer';
}

/** The cell's tooltip: its own role, then each role it holds from elsewhere ("Maintainer through QA"). */
function cellTitle(cell: GridCell): string {
  if (cell.state.admin) return 'Administrator: can do everything on every project';
  const lines: string[] = [];
  if (cell.state.role) lines.push(`${PROJECT_ROLE_LABELS[cell.state.role]} on ${targetName(cell.column)}`);
  lines.push(...cell.state.inherited.map(inheritedRoleText));
  if (lines.length === 0) lines.push(`No role on ${targetName(cell.column)}`);
  if (cell.column.projectId === null) lines.push('All projects also covers projects created later');
  return lines.join('\n');
}

// ── The role menu: one menu, anchored to the cell it edits ───────────────
const menu = shallowReactive<{
  open: boolean;
  el: HTMLElement | null;
  row: ProjectAccessRow | null;
  cell: GridCell | null;
}>({ open: false, el: null, row: null, cell: null });
let interactedOutside = false;

function openMenu(event: MouseEvent, row: ProjectAccessRow, cell: GridCell) {
  if (cell.locked || cell.saving) return;
  menu.el = event.currentTarget as HTMLElement;
  menu.row = row;
  menu.cell = cell;
  menu.open = true;
}

function choose(role: ProjectRole | null) {
  const { row, cell } = menu;
  menu.open = false;
  if (!row || !cell || cell.state.role === role) return;
  emit('change', row.subject, cell.column.projectId, role);
}

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const { row, cell } = menu;
  if (!row || !cell) return [];
  const current = cell.state.role;
  return [
    [
      { type: 'label', label: `${row.name} on ${targetName(cell.column)}` },
      { label: 'No role', type: 'checkbox', checked: current === null, onSelect: () => choose(null) },
    ],
    PROJECT_ROLES.map((role) => ({
      label: PROJECT_ROLE_LABELS[role],
      description: PROJECT_ROLE_DESCRIPTIONS[role],
      type: 'checkbox' as const,
      checked: current === role,
      onSelect: () => choose(role),
    })),
  ];
});

/**
 * Where the menu opens: a stable virtual element reading the cell it edits.
 * The menu's content forwards only the props it was first given, so the
 * anchor is the same object from the start and only what it reads changes.
 */
const menuAnchor = {
  getBoundingClientRect: () => menu.el?.getBoundingClientRect() ?? new DOMRect(),
  get contextElement() {
    return menu.el ?? undefined;
  },
};

const menuContent = computed(() => ({
  reference: menuAnchor,
  side: 'bottom' as const,
  align: 'center' as const,
  sideOffset: 4,
  onInteractOutside: () => {
    interactedOutside = true;
  },
  // Back to the cell after a pick or Escape, not after a click elsewhere.
  onCloseAutoFocus: (event: Event) => {
    event.preventDefault();
    if (!interactedOutside) menu.el?.focus();
    interactedOutside = false;
  },
}));

function isMenuCell(row: ProjectAccessRow, cell: GridCell): boolean {
  return (
    menu.open &&
    menu.row?.subject.type === row.subject.type &&
    menu.row?.subject.id === row.subject.id &&
    menu.cell?.column.key === cell.column.key
  );
}
</script>

<template>
  <div>
    <!-- Scrolls both ways inside the card from `sm` up, so the header row and the
         name column stay pinned; on a phone it only scrolls sideways and the page
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
              <span class="text-xs font-medium text-muted">Group or user</span>
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :data-col="column.key"
              :title="column.title"
              class="sticky top-0 z-20 w-24 min-w-24 border-b border-default px-0 pb-2 pt-3 align-bottom"
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
        <tbody v-for="section in sections" :key="section.id">
          <!-- The section label sits in the pinned name column; the empty cells keep
               the highlighted column and the All projects divider unbroken. -->
          <tr>
            <th
              scope="rowgroup"
              class="sticky left-0 z-10 bg-default px-3 pb-1 pt-4 text-left align-bottom text-xs font-medium text-muted"
            >
              {{ section.label }}
            </th>
            <td
              v-for="column in columns"
              :key="column.key"
              :data-col="column.key"
              :class="[crosshair.col === column.key ? 'bg-elevated' : '', { 'border-r': column.projectId === null }]"
              class="border-default"
            />
          </tr>
          <tr v-for="row in section.rows" :key="accessSubjectKey(row.subject)">
            <th
              scope="row"
              :data-row="accessSubjectKey(row.subject)"
              class="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-b border-default px-3 py-1.5 text-left font-normal sm:w-56 sm:min-w-56 sm:max-w-56"
              :class="crosshair.row === accessSubjectKey(row.subject) ? 'bg-elevated' : 'bg-default'"
            >
              <!-- Wraps on a phone, where a truncated name has no tooltip to recover it. -->
              <span class="block break-words text-sm text-highlighted sm:truncate" :title="row.name">{{
                row.name
              }}</span>
              <span
                v-if="rowMeta(row)"
                class="block break-words text-xs text-muted sm:truncate"
                :title="rowMeta(row)"
                >{{ rowMeta(row) }}</span
              >
            </th>
            <td
              v-for="cell in cellsOf(row)"
              :key="cell.column.key"
              :data-row="accessSubjectKey(row.subject)"
              :data-col="cell.column.key"
              class="border-b border-default p-0.5 text-center"
              :class="[
                cellHighlight(accessSubjectKey(row.subject), cell.column.key),
                { 'border-r': cell.column.projectId === null },
              ]"
            >
              <button
                type="button"
                aria-haspopup="menu"
                :aria-expanded="isMenuCell(row, cell)"
                :data-pos="`${rowIndex.get(accessSubjectKey(row.subject))}:${cell.col}`"
                :data-role="cell.state.role ?? ''"
                :tabindex="
                  active.row === rowIndex.get(accessSubjectKey(row.subject)) && active.col === cell.col ? 0 : -1
                "
                :aria-disabled="cell.locked || cell.saving"
                :aria-label="`${row.name} — ${cell.column.label}`"
                :title="cellTitle(cell)"
                class="flex h-8 w-full scroll-ml-44 scroll-mt-40 items-center justify-center rounded px-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary sm:scroll-ml-60"
                :class="[
                  cellClass(cell),
                  { 'hover:ring-1 hover:ring-inset hover:ring-accented': !cell.locked, 'opacity-60': cell.saving },
                ]"
                @click="openMenu($event, row, cell)"
                @focus="onCellFocus(rowIndex.get(accessSubjectKey(row.subject)) ?? 0, cell.col)"
                @keydown="onCellKeydown($event, rowIndex.get(accessSubjectKey(row.subject)) ?? 0, cell.col)"
              >
                <span class="truncate">{{ cellText(cell) }}</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-3 text-xs text-muted">
      <span class="font-medium text-highlighted">Role</span> granted here · <span>Role</span> held through a group or
      All projects · Administrators can do everything and are not edited here
    </p>

    <UDropdownMenu
      :open="menu.open"
      :modal="false"
      :items="menuItems"
      :content="menuContent"
      :ui="{ content: 'w-72', itemDescription: 'whitespace-normal' }"
      @update:open="menu.open = $event"
    />
  </div>
</template>
