<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type {
  ProjectWithTestRuns,
  TestRunSummary,
  PerformanceTrendPoint,
  SlowTest,
  FlakyTest,
  ProjectMemberEntry,
  ProjectMembersResponse,
  UserDetails,
  UsersResponse,
  MarkersResponse,
  TagInfo,
  TagsResponse,
} from '~~/types/api';
import type { FilterBarState } from '~/components/shared/FilterBar.vue';
import { RUN_STATUS_SERIES, legendOf } from '~/utils/chart';

const route = useRoute();
const router = useRouter();
const projectId = route.params.id as string;

// === MAIN PROJECT DATA ===
const { data: project, refresh } = await useFetch<ProjectWithTestRuns>(`/api/projects/${projectId}`);

useHead(computed(() => ({ title: `${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard` })));

const toast = useToast();
const deletingRunId = ref<number | null>(null);
const confirmDeleteRunId = ref<number | null>(null);

const { isAdmin, isReporter } = useAuth();
// Project-level capability states gate the bell, the Quarantine segment and the
// Timeline's add-marker control.
const { isHidden: projCapHidden } = await useProjectCapabilities(Number(projectId));
const runtimeConfig = useRuntimeConfig();
const { isDesktop, openReport } = useDesktopReportLink();
const authEnabled = computed(() => Boolean(runtimeConfig.public.authEnabled));
const canManage = computed(() => !authEnabled.value || isAdmin.value);
const canEditMarkers = computed(() => !authEnabled.value || isAdmin.value || isReporter.value);

const showDeleteProjectModal = ref(false);
const deleteProjectConfirmInput = ref('');
const deletingProject = ref(false);
const deleteProjectConfirmValid = computed(() => deleteProjectConfirmInput.value === project.value?.name);

async function handleDeleteProject() {
  if (!deleteProjectConfirmValid.value) return;
  deletingProject.value = true;
  try {
    await $fetch(`/api/projects/${projectId}` as '/api/projects/:id', { method: 'DELETE' });
    toast.add({ title: 'Project deleted', color: 'success' });
    await refreshNuxtData();
    await router.push('/');
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Delete failed', description: message || 'An error occurred', color: 'error' });
    deletingProject.value = false;
  }
}

async function handleDeleteRun(runId: number) {
  confirmDeleteRunId.value = null;
  deletingRunId.value = runId;
  try {
    await $fetch(`/api/test-runs/${runId}`, { method: 'DELETE' });
    toast.add({ title: 'Test run deleted', color: 'success' });
    await refresh();
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Delete failed', description: message || 'An error occurred', color: 'error' });
  } finally {
    deletingRunId.value = null;
  }
}

// === FILTER BAR (persisted per project) ===
const filters = useCookie<FilterBarState>(`piwi-filters-project-${projectId}`, {
  default: () => ({ environments: [], branches: [], fullRunsOnly: true }),
  encode: (v) => JSON.stringify(v),
  decode: (v) => {
    try {
      return v ? (JSON.parse(v) as FilterBarState) : { environments: [], branches: [], fullRunsOnly: true };
    } catch {
      return { environments: [], branches: [], fullRunsOnly: true };
    }
  },
});

// A run's branch reads the scalar column, falling back to the SCM metadata for
// runs reported before the branch column existed.
function runBranch(run: { branch?: string | null; metadata?: { scm?: { branch?: string | null } } | null }) {
  return run.branch ?? run.metadata?.scm?.branch ?? null;
}

const availableEnvironments = computed(() => {
  const envs = new Set<string>();
  for (const run of project.value?.testRuns || []) if (run.environment) envs.add(run.environment);
  return [...envs].sort();
});

const availableBranches = computed(() => {
  const branches = new Set<string>();
  for (const run of project.value?.testRuns || []) {
    const b = runBranch(run);
    if (b) branches.add(b);
  }
  return [...branches].sort();
});

const filteredRuns = computed(() => {
  let runs = project.value?.testRuns || [];
  if (filters.value.fullRunsOnly) runs = runs.filter((r) => r.isFullRun !== false);
  if (filters.value.environments.length > 0)
    runs = runs.filter((r) => r.environment && filters.value.environments.includes(r.environment));
  if (filters.value.branches.length > 0)
    runs = runs.filter((r) => {
      const b = runBranch(r);
      return b !== null && filters.value.branches.includes(b);
    });
  return runs;
});

// A single selected environment / branch scopes the server-side flaky and
// performance analysis so one environment or feature branch can be compared.
const flakyEnvironment = computed(() =>
  filters.value.environments.length === 1 ? filters.value.environments[0] : undefined,
);
const flakyBranch = computed(() => (filters.value.branches.length === 1 ? filters.value.branches[0] : undefined));

// === STATUS-LINE FIGURES ===
// The latest run and the pass rate come from the runs already loaded; the open
// clusters, flaky and quarantined counts come from the same endpoints the
// Failures tab reads, fetched lazily so they never block the first paint.
const latestRun = computed(() => {
  const runs = project.value?.testRuns ?? [];
  if (runs.length === 0) return null;
  return [...runs].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0]!;
});

const passRate20 = computed(() => {
  const runs = [...(project.value?.testRuns ?? [])]
    .filter((r) => r.isFullRun !== false)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 20);
  let passed = 0;
  let total = 0;
  for (const r of runs) {
    passed += r.passedTests;
    total += r.totalTests;
  }
  return total > 0 ? Math.round((passed / total) * 100) : null;
});

const { data: clustersCount, refresh: refreshClustersCount } = await useFetch(
  `/api/projects/${projectId}/failure-clusters`,
  {
    lazy: true,
    server: false,
    default: () => ({ total: 0, open: 0 }),
    transform: (r: { items: Array<{ status?: string | null }> }) => ({
      total: r.items.length,
      open: r.items.filter((c) => (c.status ?? 'open') === 'open').length,
    }),
  },
);

const { data: flakyCount, refresh: refreshFlakyCount } = await useFetch(
  () => `/api/projects/${projectId}/flaky-tests?runs=50`,
  {
    lazy: true,
    server: false,
    default: () => 0,
    transform: (r: { items: FlakyTest[] }) => r.items.length,
  },
);

const { data: quarantineCount, refresh: refreshQuarantineCount } = await useFetch(
  `/api/projects/${projectId}/quarantine`,
  {
    lazy: true,
    server: false,
    default: () => 0,
    transform: (r: { debt?: { active?: number } }) => r.debt?.active ?? 0,
  },
);

// The catalog owns its fetch and emits its total for the Tests tab label.
const testCasesTotal = ref<number | null>(null);

function refreshFailureCounts() {
  refreshClustersCount();
  refreshFlakyCount();
  refreshQuarantineCount();
}

useRunStream(() => Promise.all([refresh(), refreshFailureCounts()]));

// === TABS ===
const TABS = ['runs', 'tests', 'failures', 'gaps', 'performance', 'settings'] as const;
type TabValue = (typeof TABS)[number];

// Old ?tab= values (and the retired sub-routes) still land on the right tab.
const TAB_ALIASES: Record<string, TabValue> = {
  'test-runs': 'runs',
  compare: 'runs',
  timeline: 'runs',
  'test-cases': 'tests',
  'spec-health': 'tests',
  'failure-clusters': 'failures',
  'flaky-tests': 'failures',
  quarantine: 'failures',
  'ai-steps': 'performance',
  members: 'settings',
};

type FailureSegment = 'clusters' | 'flaky' | 'quarantine';
const ALIAS_SEGMENT: Record<string, FailureSegment> = {
  'failure-clusters': 'clusters',
  'flaky-tests': 'flaky',
  quarantine: 'quarantine',
};

const activeTab = ref<TabValue>('runs');
const failureSegment = ref<FailureSegment>('clusters');

// The Quarantine segment follows the `quarantine` capability: a project that
// declined it loses the segment button, and a stale `?tab=quarantine` link falls
// back to Clusters.
const failureSegments = computed(() => {
  const segs: { key: FailureSegment; label: string; count: number }[] = [
    { key: 'clusters', label: 'Clusters', count: clustersCount.value.total },
    { key: 'flaky', label: 'Flaky', count: flakyCount.value ?? 0 },
  ];
  if (!projCapHidden('quarantine'))
    segs.push({ key: 'quarantine', label: 'Quarantine', count: quarantineCount.value ?? 0 });
  return segs;
});
watch(
  () => projCapHidden('quarantine'),
  (hidden) => {
    if (hidden && failureSegment.value === 'quarantine') failureSegment.value = 'clusters';
  },
  { immediate: true },
);

function resolveTab(raw: unknown): TabValue | null {
  if (typeof raw !== 'string') return null;
  if (TABS.includes(raw as TabValue)) return raw as TabValue;
  return TAB_ALIASES[raw] ?? null;
}

const initialTab = resolveTab(route.query.tab);
if (initialTab) {
  activeTab.value = initialTab;
  if (typeof route.query.tab === 'string' && ALIAS_SEGMENT[route.query.tab])
    failureSegment.value = ALIAS_SEGMENT[route.query.tab]!;
}

// Reflect the active tab in the URL (replace, so tab switches don't stack history).
watch(activeTab, (tab) => {
  if (route.query.tab === tab) return;
  router.replace({ query: { ...route.query, tab } });
});

// Rewrite an old ?tab= alias to its canonical value once the page is interactive.
onMounted(() => {
  if (route.query.tab !== activeTab.value) {
    router.replace({ query: { ...route.query, tab: activeTab.value } });
  }
});

const failuresCount = computed(() => clustersCount.value.open + (flakyCount.value ?? 0) + (quarantineCount.value ?? 0));

const tabItems = computed(() => [
  { label: `Runs (${filteredRuns.value.length})`, icon: 'i-lucide-play-circle', value: 'runs' as const },
  {
    label: `Tests${testCasesTotal.value != null ? ` (${testCasesTotal.value})` : ''}`,
    icon: 'i-lucide-flask-conical',
    value: 'tests' as const,
  },
  {
    label: `Failures${failuresCount.value > 0 ? ` (${failuresCount.value})` : ''}`,
    icon: 'i-lucide-layers',
    value: 'failures' as const,
  },
  { label: 'Gaps', icon: 'i-lucide-radar', value: 'gaps' as const },
  { label: 'Performance', icon: 'i-lucide-trending-up', value: 'performance' as const },
  { label: 'Settings', icon: 'i-lucide-settings', value: 'settings' as const },
]);

const tabNavItems = computed(() =>
  tabItems.value.map((item) => ({
    label: item.label,
    icon: item.icon,
    active: activeTab.value === item.value,
    'aria-current': activeTab.value === item.value ? ('true' as const) : undefined,
    onSelect: () => {
      activeTab.value = item.value;
    },
  })),
);

const tabSelectItems = computed(() => tabItems.value.map((t) => ({ label: t.label, value: t.value })));
const activeTabIcon = computed(() => tabItems.value.find((t) => t.value === activeTab.value)?.icon);

// A status-line figure links to the tab that holds it (Failures also selects the
// segment it belongs to).
function goToTab(tab: TabValue, segment?: FailureSegment) {
  if (segment) failureSegment.value = segment;
  activeTab.value = tab;
}

// === RUNS TAB: selection → compare ===
const selectedRunIds = ref<number[]>([]);
const isRunSelected = (runId: number) => selectedRunIds.value.includes(runId);

function toggleRunSelection(runId: number) {
  const idx = selectedRunIds.value.indexOf(runId);
  if (idx >= 0) {
    selectedRunIds.value.splice(idx, 1);
  } else {
    if (selectedRunIds.value.length >= 2) {
      toast.add({
        title: 'Maximum 2 runs',
        description: 'Select at most 2 runs to compare. Deselect one first.',
        color: 'warning',
      });
      return;
    }
    selectedRunIds.value.push(runId);
  }
}

// Compare opens the newer run's Changes tab with the older run as its baseline.
function compareSelectedRuns() {
  if (selectedRunIds.value.length !== 2) return;
  const [a, b] = selectedRunIds.value as [number, number];
  const newer = Math.max(a, b);
  const older = Math.min(a, b);
  navigateTo(`/test-runs/${newer}?tab=changes&baseline=${older}`);
}

function scopeTooltip(run: TestRunSummary): string {
  if (run.isFullRun !== false) return 'Full run — the complete test suite ran';
  const parts: string[] = [];
  const grep = run.filterDetails?.grep?.trim();
  const grepInvert = run.filterDetails?.grepInvert?.trim();
  const files = run.filterDetails?.files;
  if (grep && grep !== '.*') parts.push(`grep: ${grep}`);
  if (grepInvert) parts.push(`grep-invert: ${grepInvert}`);
  if (files?.length) parts.push(`files: ${files.join(', ')}`);
  return parts.length
    ? `Partial run — ${parts.join(' · ')}`
    : 'Partial run — only a filtered subset of tests ran (grep, file, or line filter)';
}

const runsColumns: TableColumn<TestRunSummary>[] = [
  { accessorKey: 'select', header: '' },
  { accessorKey: 'id', header: createSortHeader<TestRunSummary>('Run') },
  { accessorKey: 'status', header: createSortHeader<TestRunSummary>('Status') },
  { accessorKey: 'isFullRun', header: 'Scope' },
  { id: 'browsers', accessorFn: (row) => row.browsers, header: '' },
  { accessorKey: 'startTime', header: createSortHeader<TestRunSummary>('Started') },
  { accessorKey: 'environment', header: createSortHeader<TestRunSummary>('Environment') },
  { accessorKey: 'metadata', header: 'Branch / Commit' },
  { accessorKey: 'duration', header: createSortHeader<TestRunSummary>('Test status / Dur.') },
  { id: 'actions', header: '' },
];

function openRun(runId: number) {
  navigateTo(`/test-runs/${runId}`);
}

// The report links and the delete action share one row overflow menu, so the
// table fits without a horizontal scroll at 1280 px.
function runMenuItems(run: TestRunSummary) {
  // In the desktop shell a `target="_blank"` menu link is inert, so open the
  // report through the shell instead (a window for viewable reports, a disk
  // save for a blob archive); on the web it stays a normal new-tab link.
  const items: Array<Record<string, unknown>> = (run.reports ?? []).map((report) =>
    isDesktop
      ? { label: report.label, icon: reportIcon(report.type), onSelect: () => openReport(report) }
      : {
          label: report.label,
          icon: reportIcon(report.type),
          to: fileApiUrl(report.path, null, runtimeConfig.app?.baseURL),
          target: '_blank',
        },
  );
  if (items.length) items.push({ type: 'separator' });
  items.push({
    label: 'Delete run',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => {
      confirmDeleteRunId.value = run.id;
    },
  });
  return items;
}

// === RUNS TAB: markers ===
const { data: markersData, refresh: refreshMarkers } = await useFetch<MarkersResponse>(
  `/api/projects/${projectId}/markers`,
  { default: () => ({ items: [] }) },
);
const markers = computed(() => markersData.value?.items ?? []);

const visibleMarkers = computed(() => {
  if (filters.value.environments.length === 0) return markers.value;
  return markers.value.filter((m) => m.environment == null || filters.value.environments.includes(m.environment!));
});

const markersOpen = ref(false);
const focusMarkerId = ref<number | null>(null);

function handleMarkerClick(id: number) {
  focusMarkerId.value = id;
  markersOpen.value = true;
}

// === PERFORMANCE TAB ===
const RUNS_WINDOW_OPTIONS = [
  { label: 'Last 20 runs', value: 20 },
  { label: 'Last 50 runs', value: 50 },
  { label: 'Last 100 runs', value: 100 },
  { label: 'Last 200 runs', value: 200 },
];
const perfRunsWindow = ref(50);

const performanceData = ref<PerformanceTrendPoint[] | null>(null);
const performanceLoading = ref(false);
const slowTests = ref<SlowTest[] | null>(null);
const slowTestsError = ref(false);
const slowTestsLoading = ref(false);
const performanceInitialLoading = computed(() => performanceLoading.value && performanceData.value === null);

// Whether the project ships committed AI-step artifacts; the coverage card only
// appears when it does.
const { data: hasAiSteps } = await useFetch(`/api/projects/${projectId}/ai-steps?days=90`, {
  lazy: true,
  server: false,
  default: () => false,
  transform: (r: { artifacts?: unknown[] }) => (r.artifacts?.length ?? 0) > 0,
});

watch(
  [activeTab, perfRunsWindow, () => filters.value.fullRunsOnly],
  async ([tab, runsWindow]) => {
    if (tab !== 'performance') return;
    performanceLoading.value = true;
    if (!slowTests.value) slowTestsLoading.value = true;
    if (import.meta.server) return;
    const params = new URLSearchParams({ runs: String(runsWindow) });
    if (!filters.value.fullRunsOnly) params.set('fullRunsOnly', 'false');
    const perfRes = await $fetch<{ items: PerformanceTrendPoint[] }>(
      `/api/projects/${projectId}/performance?${params.toString()}`,
    ).catch((err) => {
      console.warn('[PerformanceTab] Failed to fetch performance trend:', err);
      return null;
    });
    performanceData.value = perfRes?.items ?? null;
    performanceLoading.value = false;
    if (slowTestsLoading.value) {
      slowTestsError.value = false;
      const slowRes = await $fetch<{ items: SlowTest[] }>(`/api/projects/${projectId}/slow-tests`).catch((err) => {
        slowTestsError.value = true;
        console.warn('[PerformanceTab] Failed to fetch slow tests:', err);
        return null;
      });
      slowTests.value = slowRes?.items ?? null;
      slowTestsLoading.value = false;
    }
  },
  { immediate: true },
);

const slowTestsColumns: TableColumn<SlowTest>[] = [
  { accessorKey: 'title', header: createSortHeader<SlowTest>('Test') },
  { accessorKey: 'avgDuration', header: createSortHeader<SlowTest>('Avg duration') },
  { accessorKey: 'maxDuration', header: createSortHeader<SlowTest>('Max') },
  { accessorKey: 'minDuration', header: createSortHeader<SlowTest>('Min') },
  { accessorKey: 'latestDuration', header: createSortHeader<SlowTest>('Latest') },
  { accessorKey: 'trend', header: createSortHeader<SlowTest>('Trend') },
  { accessorKey: 'runCount', header: createSortHeader<SlowTest>('Runs') },
];

// Latest run seeds the slow-endpoints selector.
const slowEndpointsRunId = ref<number | null>(null);
watch(
  latestRun,
  (run) => {
    if (run && slowEndpointsRunId.value == null) slowEndpointsRunId.value = run.id;
  },
  { immediate: true },
);

// === SETTINGS TAB: members ===
const members = ref<ProjectMemberEntry[]>([]);
const allUsers = ref<UserDetails[]>([]);
const selectedMemberIds = ref<number[]>([]);

const mergedMembers = computed(() => {
  const memberMap = new Map(members.value.map((m) => [m.id, m]));
  const result: (ProjectMemberEntry & { hasAccess: boolean })[] = [];
  for (const u of allUsers.value) {
    if (u.role === 'administrator') continue;
    const m = memberMap.get(u.id);
    result.push({
      id: u.id,
      username: u.username,
      name: u.name ?? null,
      role: u.role,
      global: m?.global ?? false,
      hasAccess: !!m,
    });
  }
  for (const m of members.value) if (m.role === 'administrator') result.push({ ...m, hasAccess: true });
  return result;
});

const membersChanged = computed(() => {
  const originalIds = members.value
    .filter((m) => m.role !== 'administrator' && !m.global)
    .map((m) => m.id)
    .sort();
  const currentIds = [...selectedMemberIds.value].sort();
  return JSON.stringify(originalIds) !== JSON.stringify(currentIds);
});

watch(
  () => project.value?.id,
  async (newId) => {
    if (!newId || !isAdmin.value) return;
    try {
      const [membersData, usersData] = await Promise.all([
        $fetch<ProjectMembersResponse>(`/api/projects/${projectId}/members`),
        $fetch<UsersResponse>('/api/users'),
      ]);
      members.value = membersData.items;
      allUsers.value = usersData.items;
      selectedMemberIds.value = membersData.items
        .filter((m) => m.role !== 'administrator' && !m.global)
        .map((m) => m.id);
    } catch {
      members.value = [];
      allUsers.value = [];
      selectedMemberIds.value = [];
    }
  },
  { immediate: true },
);

function toggleMemberSelection(userId: number) {
  const idx = selectedMemberIds.value.indexOf(userId);
  if (idx >= 0) selectedMemberIds.value.splice(idx, 1);
  else selectedMemberIds.value.push(userId);
}

async function handleSaveMembers() {
  try {
    await $fetch(`/api/projects/${projectId}/members`, {
      method: 'PUT',
      body: { userIds: selectedMemberIds.value },
    });
    toast.add({ title: 'Members updated', color: 'success' });
    const data = await $fetch<ProjectMembersResponse>(`/api/projects/${projectId}/members`);
    members.value = data.items;
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Update failed', description: message || 'An error occurred', color: 'error' });
  }
}

// === SETTINGS TAB: project edit form ===
const { data: tagsData, refresh: refreshTags } = await useFetch<TagsResponse>('/api/tags');
const allTags = computed(() => tagsData.value?.items || []);

const storedCiRerun = computed(
  () =>
    (project.value as { ciRerun?: unknown } | null)?.ciRerun as {
      enabled?: boolean;
      github?: { workflow?: string; ref?: string; inputName?: string };
      gitlab?: { ref?: string; variableName?: string };
      bitbucket?: { pipeline?: string; variableName?: string };
    } | null,
);

const storedServerProbes = computed(
  () =>
    (project.value as { serverProbes?: unknown } | null)?.serverProbes as {
      enabled?: boolean;
      faults?: string[];
      routes?: string[];
      dependencyOnStateChanging?: boolean;
    } | null,
);

const editState = ref({
  label: '',
  description: '',
  diagnosisInstructions: '',
  aiLanguage: '',
  scmToken: '',
  defaultBranch: '',
  openApiUrl: '',
  serverProbes: { enabled: false, faults: '', routes: '', dependencyOnStateChanging: false },
  ciRerun: {
    enabled: false,
    github: { workflow: '', ref: '', inputName: '' },
    gitlab: { ref: '', variableName: '' },
    bitbucket: { pipeline: '', variableName: '' },
  },
});
const selectedTags = ref<TagInfo[]>([]);
const savingSettings = ref(false);
const hasScmToken = computed(() => Boolean((project.value as { hasScmToken?: boolean } | null)?.hasScmToken));

watch(
  project,
  (p) => {
    if (!p) return;
    const ci = storedCiRerun.value;
    editState.value = {
      label: p.label || '',
      description: p.description || '',
      diagnosisInstructions: (p as { diagnosisInstructions?: string }).diagnosisInstructions || '',
      aiLanguage: (p as { aiLanguage?: string }).aiLanguage || '',
      scmToken: '',
      defaultBranch: (p as { defaultBranch?: string }).defaultBranch || '',
      openApiUrl: (p as { openApiUrl?: string }).openApiUrl || '',
      serverProbes: {
        enabled: storedServerProbes.value?.enabled ?? false,
        faults: (storedServerProbes.value?.faults ?? []).join(', '),
        routes: (storedServerProbes.value?.routes ?? []).join(', '),
        dependencyOnStateChanging: storedServerProbes.value?.dependencyOnStateChanging ?? false,
      },
      ciRerun: {
        enabled: ci?.enabled ?? false,
        github: {
          workflow: ci?.github?.workflow ?? '',
          ref: ci?.github?.ref ?? '',
          inputName: ci?.github?.inputName ?? '',
        },
        gitlab: { ref: ci?.gitlab?.ref ?? '', variableName: ci?.gitlab?.variableName ?? '' },
        bitbucket: { pipeline: ci?.bitbucket?.pipeline ?? '', variableName: ci?.bitbucket?.variableName ?? '' },
      },
    };
    selectedTags.value = p.tags || [];
  },
  { immediate: true },
);

/** Split a comma/whitespace-separated form value into a trimmed, non-empty list. */
function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function handleSaveSettings() {
  savingSettings.value = true;
  try {
    await $fetch(`/api/projects/${projectId}` as '/api/projects/:id', {
      method: 'PATCH',
      body: {
        label: editState.value.label || null,
        description: editState.value.description || null,
        diagnosisInstructions: editState.value.diagnosisInstructions || null,
        aiLanguage: editState.value.aiLanguage || null,
        scmToken: editState.value.scmToken || null,
        defaultBranch: editState.value.defaultBranch || null,
        openApiUrl: editState.value.openApiUrl || null,
        serverProbes: {
          enabled: editState.value.serverProbes.enabled,
          faults: splitCommaList(editState.value.serverProbes.faults),
          routes: splitCommaList(editState.value.serverProbes.routes),
          dependencyOnStateChanging: editState.value.serverProbes.dependencyOnStateChanging,
        },
        ciRerun: editState.value.ciRerun,
        tagIds: selectedTags.value.map((t) => t.id),
      },
    });
    toast.add({ title: 'Project updated', description: 'Project settings have been saved.', color: 'success' });
    await refresh();
  } catch {
    toast.add({ title: 'Error', description: 'Failed to update project', color: 'error' });
  } finally {
    savingSettings.value = false;
  }
}

// Clusters list refreshes after a suggested merge is approved.
const clustersRefreshKey = ref(0);

// === NAVBAR MORE MENU ===
const moreMenuItems = computed(() => {
  const items: { label: string; icon: string; color?: 'error'; onSelect: () => void; to?: string }[] = [];
  items.push({ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => goToTab('settings') });
  items.push({
    label: 'Test functions',
    icon: 'i-lucide-square-function',
    onSelect: () => navigateTo(`/projects/${projectId}/test-functions`),
  });
  items.push({
    label: 'Selections',
    icon: 'i-lucide-list-filter',
    onSelect: () => navigateTo(`/projects/${projectId}/selections`),
  });
  if (canManage.value)
    items.push({
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => {
        deleteProjectConfirmInput.value = '';
        showDeleteProjectModal.value = true;
      },
    });
  items.push({ label: 'Refresh', icon: 'i-lucide-refresh-cw', onSelect: () => refresh() });
  return items;
});
</script>

<template>
  <UDashboardPanel id="project-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project' },
            ]"
          />
        </template>
        <template #right>
          <div class="flex items-center gap-1.5 shrink-0">
            <SubscribeBell
              v-if="!projCapHidden('notifications')"
              :project-id="parseInt(projectId)"
              :project-label="project?.label || project?.name"
            />
            <UButton
              v-if="canManage"
              label="Import"
              icon="i-lucide-import"
              size="sm"
              :to="`/projects/${projectId}/import`"
            />
            <UDropdownMenu :items="moreMenuItems">
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis-vertical"
                aria-label="More actions"
                title="More actions"
              />
            </UDropdownMenu>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col h-full overflow-y-auto gap-4">
        <!-- Header block: description, tags, status line, filter bar -->
        <div class="space-y-3">
          <p v-if="project?.description" class="text-gray-600 dark:text-gray-400">
            {{ project.description }}
          </p>

          <div v-if="project?.tags && project.tags.length > 0" class="flex flex-wrap gap-1">
            <TagBadge v-for="tag in project.tags" :key="tag.id" :text="tag.text" :color="tag.color" />
          </div>

          <!-- Status line: the project's condition on entry, each figure a link -->
          <div
            v-if="latestRun"
            class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted"
            data-shot="status-line"
          >
            <HelpHint topic="project.status-line" />
            <button type="button" class="inline-flex items-center gap-1.5 hover:underline" @click="goToTab('runs')">
              <RunStatusBadge :status="latestRun.status" />
              <span>Latest run #{{ latestRun.id }} {{ formatRelativeTime(latestRun.startTime) }}</span>
            </button>
            <span class="text-gray-300 dark:text-gray-600">·</span>
            <button
              v-if="passRate20 !== null"
              type="button"
              class="hover:underline tabular-nums"
              @click="goToTab('runs')"
            >
              {{ passRate20 }}% pass rate <span class="text-gray-400">(last 20 runs)</span>
            </button>
            <span class="text-gray-300 dark:text-gray-600">·</span>
            <button
              type="button"
              class="hover:underline tabular-nums"
              :class="clustersCount.open > 0 ? 'text-red-600 dark:text-red-400' : ''"
              @click="goToTab('failures', 'clusters')"
            >
              {{ clustersCount.open }} open {{ clustersCount.open === 1 ? 'cluster' : 'clusters' }}
            </button>
            <span class="text-gray-300 dark:text-gray-600">·</span>
            <button
              type="button"
              class="hover:underline tabular-nums"
              :class="(flakyCount ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : ''"
              @click="goToTab('failures', 'flaky')"
            >
              {{ flakyCount ?? 0 }} flaky
            </button>
            <span class="text-gray-300 dark:text-gray-600">·</span>
            <button type="button" class="hover:underline tabular-nums" @click="goToTab('failures', 'quarantine')">
              {{ quarantineCount ?? 0 }} quarantined
            </button>
          </div>

          <div class="flex items-center gap-1.5">
            <FilterBar
              v-model="filters"
              :available-environments="availableEnvironments"
              :available-branches="availableBranches"
            />
            <HelpHint topic="project.filters" />
          </div>
        </div>

        <!-- Desktop shell only (renders nothing without the IPC bridge). -->
        <DesktopProjectLinkCard :project-id="projectId" />

        <!-- Mobile: a select replaces the cramped tab strip; the strip scrolls from sm up. -->
        <USelect
          v-model="activeTab"
          :items="tabSelectItems"
          value-key="value"
          :icon="activeTabIcon"
          size="md"
          aria-label="Select tab"
          class="w-full sm:hidden"
        />
        <UDashboardToolbar class="hidden sm:block p-1">
          <UNavigationMenu
            :items="tabNavItems"
            highlight
            class="-mx-1 flex-1"
            :ui="{ list: 'overflow-x-auto', root: 'min-w-0' }"
          />
        </UDashboardToolbar>

        <!-- RUNS TAB -->
        <div v-if="activeTab === 'runs'">
          <ChartCard
            v-if="filteredRuns.length > 0"
            title="Run trend"
            subtitle="One bar per run, newest on the right"
            help="project.runs-trend"
            :legend="legendOf(RUN_STATUS_SERIES)"
            data-shot="run-trend"
          >
            <template #actions>
              <UButton
                v-if="!projCapHidden('markers')"
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-milestone"
                :label="`Markers (${markers.length})`"
                @click="markersOpen = true"
              />
            </template>
            <TestRunsChart :test-runs="filteredRuns" :markers="visibleMarkers" @marker-click="handleMarkerClick" />
          </ChartCard>

          <UCard class="mt-4">
            <div
              v-if="selectedRunIds.length > 0"
              class="flex items-center gap-3 px-3 py-2 mb-3 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800"
            >
              <span class="text-sm text-primary-700 dark:text-primary-300">
                {{ selectedRunIds.length }} run{{ selectedRunIds.length > 1 ? 's' : '' }} selected
              </span>
              <UButton
                v-if="selectedRunIds.length === 2"
                icon="i-lucide-git-compare-arrows"
                size="sm"
                color="primary"
                label="Compare"
                @click="compareSelectedRuns"
              />
              <span v-else class="text-xs text-primary-500">Select another run to compare</span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-x"
                label="Clear"
                @click="selectedRunIds = []"
              />
            </div>

            <!-- md+ : the runs table; below md a card list keeps it scroll-free -->
            <div class="hidden md:block">
              <UTable
                v-if="filteredRuns.length > 0"
                :data="filteredRuns"
                :columns="runsColumns"
                :ui="{
                  base: 'w-full border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:hover:bg-gray-50 dark:[&>tr]:hover:bg-gray-900/50',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default',
                }"
              >
                <template #select-cell="{ row }">
                  <input
                    type="checkbox"
                    :checked="isRunSelected(row.original.id)"
                    class="cursor-pointer size-4 accent-primary"
                    :aria-label="`Select run #${row.original.id}`"
                    @click.stop="toggleRunSelection(row.original.id)"
                  />
                </template>
                <template #id-cell="{ row }">
                  <div class="flex items-center gap-2">
                    <a
                      :href="`/test-runs/${row.original.id}`"
                      class="text-primary hover:underline font-medium"
                      @click.prevent="openRun(row.original.id)"
                    >
                      Run #{{ row.original.id }}
                    </a>
                    <span v-if="row.original.label" class="text-xs text-gray-500 dark:text-gray-400 truncate max-w-32">
                      {{ row.original.label }}
                    </span>
                  </div>
                </template>
                <template #status-cell="{ row }">
                  <RunStatusBadge
                    :status="row.original.status"
                    class="cursor-pointer"
                    @click="openRun(row.original.id)"
                  />
                </template>
                <template #isFullRun-header>
                  <span class="inline-flex items-center gap-1">Scope <HelpHint topic="run.partial" /></span>
                </template>
                <template #isFullRun-cell="{ row }">
                  <UTooltip :text="scopeTooltip(row.original)">
                    <UIcon
                      :name="row.original.isFullRun === false ? 'i-lucide-list-filter' : 'i-lucide-list-checks'"
                      class="size-4 shrink-0 cursor-help"
                      :class="row.original.isFullRun === false ? 'text-amber-500' : 'text-green-500'"
                    />
                  </UTooltip>
                </template>
                <template #browsers-cell="{ row }">
                  <div v-if="row.original.browsers?.length" class="flex items-center gap-1">
                    <BrowserBadge
                      v-for="name in row.original.browsers"
                      :key="name"
                      :browser="{ projectName: name }"
                      size="sm"
                    />
                  </div>
                </template>
                <template #startTime-cell="{ row }">
                  <ClientDate
                    :date="row.original.startTime"
                    class="text-xs text-gray-600 cursor-pointer"
                    @click="openRun(row.original.id)"
                  />
                </template>
                <template #environment-cell="{ row }">
                  <EnvironmentBadge v-if="row.original.environment" :name="row.original.environment" class="text-xs" />
                </template>
                <template #metadata-cell="{ row }">
                  <div
                    v-if="runBranch(row.original) || row.original.metadata?.scm?.commit"
                    class="flex items-center gap-1.5 flex-wrap text-xs cursor-pointer"
                    @click="openRun(row.original.id)"
                  >
                    <BranchLabel
                      v-if="runBranch(row.original)"
                      :name="runBranch(row.original)"
                      class="text-gray-600 dark:text-gray-300 max-w-[12rem]"
                    />
                    <code v-if="row.original.metadata?.scm?.commit" class="text-gray-500">
                      {{ row.original.metadata.scm.commit.substring(0, 7) }}
                    </code>
                  </div>
                </template>
                <template #duration-cell="{ row }">
                  <div class="space-y-1 cursor-pointer" @click="openRun(row.original.id)">
                    <TestStatusBar
                      :passed="row.original.passedTests"
                      :failed="row.original.failedTests"
                      :skipped="row.original.skippedTests"
                      :flaky="row.original.flakyTests"
                      :did-not-run="row.original.didNotRunTests ?? 0"
                      :total="row.original.totalTests"
                    />
                    <DurationValue :ms="row.original.duration" class="text-xs text-gray-500" />
                  </div>
                </template>
                <template #actions-cell="{ row }">
                  <div class="flex justify-end">
                    <UDropdownMenu :items="runMenuItems(row.original)" :content="{ align: 'end' }">
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-ellipsis-vertical"
                        :aria-label="`Run #${row.original.id} actions`"
                        :loading="deletingRunId === row.original.id"
                        @click.stop
                      />
                    </UDropdownMenu>
                  </div>
                </template>
              </UTable>
            </div>

            <!-- Below md: one card per run -->
            <div v-if="filteredRuns.length > 0" class="space-y-2 md:hidden">
              <div v-for="run in filteredRuns" :key="run.id" class="rounded-lg border border-default p-3 space-y-2">
                <div class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    :checked="isRunSelected(run.id)"
                    class="cursor-pointer size-4 mt-1 accent-primary shrink-0"
                    :aria-label="`Select run #${run.id}`"
                    @click.stop="toggleRunSelection(run.id)"
                  />
                  <NuxtLink :to="`/test-runs/${run.id}`" class="flex-1 min-w-0 space-y-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <RunStatusBadge :status="run.status" />
                      <span class="font-medium text-primary">Run #{{ run.id }}</span>
                      <EnvironmentBadge v-if="run.environment" :name="run.environment" class="text-xs text-muted" />
                    </div>
                    <TestStatusBar
                      :passed="run.passedTests"
                      :failed="run.failedTests"
                      :skipped="run.skippedTests"
                      :flaky="run.flakyTests"
                      :did-not-run="run.didNotRunTests ?? 0"
                      :total="run.totalTests"
                    />
                    <div class="flex items-center justify-between text-xs text-muted">
                      <ClientDate :date="run.startTime" />
                      <DurationValue :ms="run.duration" />
                    </div>
                  </NuxtLink>
                  <UDropdownMenu :items="runMenuItems(run)" :content="{ align: 'end' }">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-ellipsis-vertical"
                      :aria-label="`Run #${run.id} actions`"
                      :loading="deletingRunId === run.id"
                      @click.stop.prevent
                    />
                  </UDropdownMenu>
                </div>
              </div>
            </div>

            <div
              v-if="filteredRuns.length === 0 && project?.testRuns && project.testRuns.length > 0"
              class="text-center py-8 text-gray-500"
            >
              No test runs match the current filters.
            </div>

            <EmptyState
              v-else-if="!project?.testRuns || project.testRuns.length === 0"
              icon="i-lucide-rocket"
              text="No test runs yet for this project."
            >
              <p class="text-xs text-gray-400 max-w-sm">
                Point the reporter's <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">projectName</code> at
                <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ project?.name }}</code> to send results here
                — <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">npx @piwitests/reporter init</code> wires a
                Playwright project in one command, or see the
                <DocLink to="guide/reporter" no-icon class="text-primary hover:underline">reporter docs</DocLink> for
                manual setup.
              </p>
            </EmptyState>
          </UCard>
        </div>

        <!-- TESTS TAB -->
        <div v-if="activeTab === 'tests'">
          <ProjectTestCasesTable
            :project-id="projectId"
            :project-name="project?.name"
            sync-query
            @total="testCasesTotal = $event"
          />
        </div>

        <!-- FAILURES TAB -->
        <div v-if="activeTab === 'failures'" class="space-y-4">
          <div class="flex">
            <div class="inline-flex rounded-lg border border-default p-0.5 bg-elevated/40">
              <button
                v-for="seg in failureSegments"
                :key="seg.key"
                type="button"
                class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                :class="
                  failureSegment === seg.key
                    ? 'bg-default shadow-sm text-highlighted'
                    : 'text-muted hover:text-highlighted'
                "
                :aria-pressed="failureSegment === seg.key"
                @click="failureSegment = seg.key"
              >
                {{ seg.label }} <span class="tabular-nums text-muted">({{ seg.count }})</span>
              </button>
            </div>
          </div>

          <template v-if="failureSegment === 'clusters'">
            <ClusterMergeSuggestions
              :key="`sug-${clustersRefreshKey}`"
              :project-id="String(projectId)"
              @merged="
                clustersRefreshKey++;
                refreshClustersCount();
              "
            />
            <FailureClustersList
              :key="clustersRefreshKey"
              :project-id="String(projectId)"
              @count="clustersCount.total = $event"
            />
          </template>

          <FlakyTestsList
            v-else-if="failureSegment === 'flaky'"
            :project-id="String(projectId)"
            :environment="flakyEnvironment"
            :branch="flakyBranch"
            :project-name="project?.name"
            @count="flakyCount = $event"
            @quarantined="refreshQuarantineCount"
          />

          <QuarantineTable
            v-else
            :project-id="String(projectId)"
            :project-name="project?.name"
            hide-candidates
            @count="quarantineCount = $event"
          />
        </div>

        <!-- GAPS TAB -->
        <div v-if="activeTab === 'gaps'">
          <GapsPanel :project-id="Number(projectId)" />
        </div>

        <!-- PERFORMANCE TAB -->
        <div v-if="activeTab === 'performance'" class="space-y-4">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm text-muted shrink-0">Period:</span>
            <USelect v-model="perfRunsWindow" :items="RUNS_WINDOW_OPTIONS" size="sm" class="w-40" />
          </div>

          <ChartCard
            title="Performance trend"
            subtitle="Duration metrics per run, newest on the right"
            help="project.performance"
            data-shot="performance-trend"
          >
            <LoadingState v-if="performanceInitialLoading" text="Loading chart…" />
            <PerformanceTrendChart
              v-else
              :data="performanceData || []"
              :markers="visibleMarkers"
              @marker-click="handleMarkerClick"
            />
          </ChartCard>

          <UCard data-shot="slowest-tests">
            <template #header>
              <h2 class="text-xl font-semibold inline-flex items-center gap-1">
                Slowest tests <HelpHint topic="project.slowest-tests" />
              </h2>
              <p class="text-sm text-gray-600 mt-1">Top 20 slowest tests across recent runs</p>
            </template>

            <LoadingState v-if="slowTestsLoading && slowTests === null" text="Loading…" />

            <TableScroller v-else-if="slowTests && slowTests.length > 0" min-width="52rem" :bleed="false">
              <UTable
                :data="slowTests"
                :columns="slowTestsColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default',
                }"
              >
                <template #title-cell="{ row }">
                  <NuxtLink :to="`/test-cases/${row.original.id}`" class="block hover:underline">
                    <div class="font-medium">{{ row.original.title }}</div>
                    <div class="mt-1">
                      <OpenInIdeLink
                        :file-path="row.original.filePath"
                        :project-key="projectId"
                        :project-name="project?.name"
                        class="text-xs"
                        @click.stop
                      />
                    </div>
                  </NuxtLink>
                </template>
                <template #avgDuration-cell="{ row }">
                  <DurationValue v-if="row.original.avgDuration" :ms="row.original.avgDuration" class="tabular-nums" />
                  <span v-else class="text-gray-400">—</span>
                </template>
                <template #maxDuration-cell="{ row }">
                  <DurationValue v-if="row.original.maxDuration" :ms="row.original.maxDuration" class="tabular-nums" />
                  <span v-else class="text-gray-400">—</span>
                </template>
                <template #minDuration-cell="{ row }">
                  <DurationValue v-if="row.original.minDuration" :ms="row.original.minDuration" class="tabular-nums" />
                  <span v-else class="text-gray-400">—</span>
                </template>
                <template #latestDuration-cell="{ row }">
                  <DurationValue
                    v-if="row.original.latestDuration"
                    :ms="row.original.latestDuration"
                    class="tabular-nums"
                  />
                  <span v-else class="text-gray-400">—</span>
                </template>
                <template #trend-cell="{ row }">
                  <span v-if="row.original.trend === 'slower'" class="text-red-600 font-medium">▲ Slower</span>
                  <span v-else-if="row.original.trend === 'faster'" class="text-green-600 font-medium">▼ Faster</span>
                  <span v-else class="text-gray-500">&mdash; Stable</span>
                </template>
              </UTable>
            </TableScroller>

            <div v-else-if="slowTestsError" class="text-center py-8 text-red-500">
              Couldn't load the slowest tests — try refreshing.
            </div>

            <div v-else class="text-center py-8 text-gray-500">No slow test data available yet.</div>
          </UCard>

          <TimeoutOpportunitiesTable :project-id="String(projectId)" :project-name="project?.name" />

          <ProjectSlowEndpoints
            v-model:run-id="slowEndpointsRunId"
            :runs="filteredRuns"
            :project-id="String(projectId)"
          />

          <AiStepCoverage v-if="hasAiSteps" :project-id="String(projectId)" />
        </div>

        <!-- SETTINGS TAB -->
        <div v-if="activeTab === 'settings'" class="space-y-4">
          <SectionCard
            v-if="isAdmin"
            icon="i-lucide-users"
            title="Members"
            help="project.members"
            subtitle="Who can see this project"
          >
            <template #actions>
              <UButton
                label="Save changes"
                icon="i-lucide-check"
                size="sm"
                :disabled="!membersChanged"
                @click="handleSaveMembers"
              />
            </template>

            <div v-if="mergedMembers.length > 0" class="space-y-2">
              <div
                v-for="member in mergedMembers"
                :key="member.id"
                class="flex items-center justify-between rounded-lg border border-default px-4 py-3"
              >
                <div>
                  <div class="font-medium text-sm">{{ member.name || member.username }}</div>
                  <div class="text-xs text-muted flex items-center gap-2">
                    <span>@{{ member.username }}</span>
                    <UBadge
                      :color="
                        member.role === 'administrator' ? 'primary' : member.role === 'reporter' ? 'info' : 'neutral'
                      "
                      variant="subtle"
                      size="xs"
                    >
                      {{ member.role }}
                    </UBadge>
                    <span v-if="member.global" class="italic">Global access</span>
                  </div>
                </div>
                <UCheckbox
                  v-if="member.role !== 'administrator'"
                  :model-value="selectedMemberIds.includes(member.id)"
                  :disabled="member.global"
                  :title="member.global ? 'Has global access — remove global assignment first' : ''"
                  @change="toggleMemberSelection(member.id)"
                />
                <span v-else class="text-xs text-muted italic">Admin</span>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">Loading members…</div>
          </SectionCard>

          <SectionCard icon="i-lucide-settings" title="Project settings" :subtitle="`Project key: ${project?.name}`">
            <p class="text-xs text-gray-500 mb-4">
              The project name matches results from the reporter and cannot be changed.
            </p>
            <UForm :state="editState" class="space-y-5" @submit="handleSaveSettings">
              <ProjectFormFields
                mode="edit"
                :has-token="hasScmToken"
                :project-id="Number(projectId)"
                :capabilities="project?.capabilities ?? null"
                v-model:label="editState.label"
                v-model:description="editState.description"
                v-model:diagnosisInstructions="editState.diagnosisInstructions"
                v-model:aiLanguage="editState.aiLanguage"
                v-model:scmToken="editState.scmToken"
                v-model:defaultBranch="editState.defaultBranch"
                v-model:openApiUrl="editState.openApiUrl"
                v-model:serverProbes="editState.serverProbes"
                v-model:ciRerun="editState.ciRerun"
                v-model:tags="selectedTags"
                :all-tags="allTags"
                @tag-created="refreshTags()"
              />
              <div class="flex justify-end gap-2 pt-2">
                <UButton type="submit" icon="i-lucide-check" :loading="savingSettings">Save changes</UButton>
              </div>
            </UForm>
          </SectionCard>

          <!-- Issue-tracker binding: how this project's failures reach Jira. -->
          <ProjectIntegrationSettings v-if="canManage" :project-id="Number(projectId)" />

          <!-- Desktop shell only: the linked folder is a per-machine setting. -->
          <DesktopProjectFolderSection :project-id="projectId" :project-name="project?.name" />
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Markers slide-over -->
  <ClientOnly>
    <USlideover v-model:open="markersOpen" title="Timeline markers" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <ProjectTimeline
          :project-id="Number(projectId)"
          :markers="markers"
          :environments="availableEnvironments"
          :can-edit="canEditMarkers"
          :focus-marker-id="focusMarkerId"
          @changed="refreshMarkers"
          @clear-focus="focusMarkerId = null"
        />
      </template>
    </USlideover>
  </ClientOnly>

  <!-- Delete Project Modal -->
  <ClientOnly>
    <UModal
      :open="showDeleteProjectModal"
      title="Delete project"
      @update:open="
        (val) => {
          if (!val) showDeleteProjectModal = false;
        }
      "
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            This will permanently delete <strong>{{ project?.label || project?.name }}</strong> and all its test runs,
            reports, traces, and failure clusters. This action cannot be undone.
          </p>
          <div>
            <label class="block text-sm font-medium mb-1">
              Type the project key <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ project?.name }}</code> to
              confirm:
            </label>
            <UInput
              v-model="deleteProjectConfirmInput"
              :placeholder="project?.name"
              autofocus
              @keydown.enter="handleDeleteProject"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="showDeleteProjectModal = false" />
        <UButton
          color="error"
          label="Delete project"
          icon="i-lucide-trash-2"
          :disabled="!deleteProjectConfirmValid"
          :loading="deletingProject"
          @click="handleDeleteProject"
        />
      </template>
    </UModal>
  </ClientOnly>

  <!-- Delete Run Confirm Dialog -->
  <ClientOnly>
    <UModal
      :open="confirmDeleteRunId !== null"
      title="Delete test run"
      @update:open="
        (val) => {
          if (!val) confirmDeleteRunId = null;
        }
      "
    >
      <template #body>
        <p>
          Are you sure you want to delete <strong>Run #{{ confirmDeleteRunId }}</strong
          >? This will also remove all associated test results, reports, and traces. This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDeleteRunId = null" />
        <UButton
          color="error"
          label="Delete"
          icon="i-lucide-trash-2"
          :loading="deletingRunId === confirmDeleteRunId"
          @click="handleDeleteRun(confirmDeleteRunId!)"
        />
      </template>
    </UModal>
  </ClientOnly>
</template>
