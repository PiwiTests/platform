<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui';
import type { ProjectWithStats } from '~~/types/api';
import ProjectsMenu from '~/components/layout/ProjectsMenu.vue';
import { getStoredDemoVersion } from '~/demo/db.client';

const route = useRoute();
const toast = useToast();
const config = useRuntimeConfig();

const open = ref(false);
const searchTerm = ref('');

type SearchResult = {
  projects: { id: number; name: string; label: string | null }[];
  runs: {
    id: number;
    label: string | null;
    status: string;
    projectId: number;
    projectName: string;
    projectLabel: string | null;
    startTime: Date;
  }[];
  cases: {
    id: number;
    title: string;
    filePath: string;
    projectId: number;
    projectName: string;
    projectLabel: string | null;
  }[];
};
const searchResults = ref<SearchResult | null>(null);

const debouncedSearch = useDebounceFn(async (q: string) => {
  if (q.trim().length < 2) {
    searchResults.value = null;
    return;
  }
  try {
    searchResults.value = await $fetch<SearchResult>('/api/search', { query: { q: q.trim() } });
  } catch {
    searchResults.value = null;
  }
}, 250);

watch(searchTerm, debouncedSearch);
watch(
  () => open.value,
  (v) => {
    if (!v) {
      searchTerm.value = '';
      searchResults.value = null;
    }
  },
);

// Fetch projects for sidebar navigation
const { data: projects, refresh: refreshProjects } = await useFetch('/api/projects', {
  key: 'projects',
  lazy: true,
  default: () => [] as ProjectWithStats[],
  transform: (r: { items: ProjectWithStats[] }) => r.items,
});

useRunStream(refreshProjects);
useNotificationStream();

// Register global "go to" keyboard chords (g h / g p / g a / g s). This is the only
// caller of useDashboard(); without it the shortcuts never register.
useDashboard();

const { canSeeAdmin } = useAuth();
const { isHidden: capHidden } = await useInstanceCapabilities();

// Extract current project ID from route (if viewing a project page)
const currentProjectId = computed(() => {
  // Check if route path starts with /projects/:id
  const match = route.path.match(/^\/projects\/(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
});

// Generate project navigation items with children
const ACTIVE_WINDOW_DAYS = 10;

const projectItems = computed<NavigationMenuItem[]>(() => {
  if (!projects.value || projects.value.length === 0) {
    return [];
  }

  const activeThreshold = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Sort alphabetically by display label
  const sorted = [...projects.value].sort((a, b) => {
    const labelA = (a.label || a.name).toLowerCase();
    const labelB = (b.label || b.name).toLowerCase();
    return labelA.localeCompare(labelB);
  });

  // Split into active and others
  const active = sorted.filter((p) => p.latestRun && new Date(p.latestRun.startTime).getTime() > activeThreshold);
  const others = sorted.filter((p) => !p.latestRun || new Date(p.latestRun.startTime).getTime() <= activeThreshold);

  function buildProjectItem(project: ProjectWithStats): NavigationMenuItem {
    const isActive = currentProjectId.value !== null && currentProjectId.value === project.id;
    const isRunning = project.latestRun?.status === 'running' || project.latestRun?.status === 'initializing';
    const status = project.latestRun?.status || 'unknown';
    const statusIcon =
      status === 'passed' ? 'i-lucide-circle-check-big' : status === 'failed' ? 'i-lucide-circle-x' : 'i-lucide-circle';
    const statusColor =
      status === 'passed' ? 'success' : status === 'failed' ? 'error' : isRunning ? 'info' : 'neutral';
    const displayLabel = project.label || project.name;

    return {
      label: displayLabel,
      icon: isRunning ? 'i-lucide-loader-circle' : 'i-lucide-circle',
      ui: isRunning ? { linkLeadingIcon: 'animate-spin' } : undefined,
      badge: {
        icon: statusIcon,
        color: statusColor as 'success' | 'error' | 'info' | 'neutral',
      },
      value: `project-${project.id}`,
      type: 'link' as const,
      to: `/projects/${project.id}`,
      active: isActive,
    };
  }

  const items: NavigationMenuItem[] = [];

  if (active.length > 0) {
    items.push({
      label: `Active (${active.length})`,
      type: 'label',
    });
    items.push(...active.map(buildProjectItem));
  }

  if (others.length > 0) {
    items.push({
      label: `Others (${others.length})`,
      type: 'label',
    });
    items.push(...others.map(buildProjectItem));
  }

  return items;
});

const links = computed(() => {
  const bottomLinks: NavigationMenuItem[] = [
    {
      label: 'GitHub',
      icon: 'i-lucide-github',
      to: 'https://github.com/piwitests/platform',
      target: '_blank',
    },
  ];
  // The MCP server link follows the `mcp` capability: a declined instance drops
  // it from the sidebar and the command palette alike.
  if (!capHidden('mcp')) {
    bottomLinks.unshift({
      label: 'MCP server',
      icon: 'i-lucide-bot',
      to: '/mcp',
      onSelect: () => {
        open.value = false;
      },
    });
  }
  // Setup is admin-only: it configures how results reach this instance and, in
  // the desktop build, exposes the local access token. Hiding the link also
  // removes it from the command palette, which is built from these same items.
  if (canSeeAdmin.value) {
    bottomLinks.unshift({
      label: 'Setup',
      icon: 'i-lucide-rocket',
      to: '/setup',
      onSelect: () => {
        open.value = false;
      },
    });
  }
  bottomLinks.unshift({
    label: 'API Docs',
    icon: 'i-lucide-book-open',
    to: '/docs',
    // `/docs` is a normal Nuxt page in every mode — it renders the API reference
    // in-app from the generated OpenAPI spec, so ordinary client navigation works.
    onSelect: () => {
      open.value = false;
    },
  });
  return [
    [
      {
        label: 'Home',
        icon: 'i-lucide-house',
        to: '/',
        onSelect: () => {
          open.value = false;
        },
      },
      {
        label: 'Analytics',
        icon: 'i-lucide-chart-line',
        to: '/analytics',
        onSelect: () => {
          open.value = false;
        },
      },
      {
        label: 'Projects',
        icon: 'i-lucide-folder',
        to: '/projects',
        onSelect: () => {
          open.value = false;
        },
      },
      ...projectItems.value,
    ],
    bottomLinks,
  ] satisfies NavigationMenuItem[][];
});

const toCommandPaletteItem = (item: NavigationMenuItem): CommandPaletteItem => ({
  label: typeof item.label === 'string' ? item.label : undefined,
  icon: item.icon,
  to: item.to,
  target: item.target,
  active: item.active,
  disabled: item.disabled,
  suffix: typeof item.badge === 'string' ? item.badge : undefined,
  children: item.children?.map((child) => toCommandPaletteItem(child)),
  onSelect: item.onSelect,
});

// The source file for a dynamic route (e.g. /projects/:id) can't be derived
// from the URL — it may be `[id].vue` or `[id]/index.vue` — so for dynamic
// routes we link to the pages directory instead of a guessed (404-ing) file.
const pageSourceUrl = computed(() => {
  const blobBase = 'https://github.com/piwitests/platform/blob/main/application/app/pages';
  const treeBase = 'https://github.com/piwitests/platform/tree/main/application/app/pages';
  const pattern = route.matched[route.matched.length - 1]?.path ?? route.path;
  if (pattern.includes(':')) return treeBase;
  return `${blobBase}${pattern === '/' ? '/index' : pattern}.vue`;
});

function runStatusIcon(status: string) {
  if (status === 'passed') return 'i-lucide-circle-check-big';
  if (status === 'failed') return 'i-lucide-circle-x';
  if (status === 'running' || status === 'initializing') return 'i-lucide-loader-circle';
  return 'i-lucide-circle';
}

const groups = computed<CommandPaletteGroup[]>(() => {
  const staticGroups: CommandPaletteGroup[] = [
    {
      id: 'links',
      label: 'Go to',
      items: links.value.flat().map((item) => toCommandPaletteItem(item)),
    },
    {
      id: 'code',
      label: 'Code',
      items: [
        {
          id: 'source',
          label: 'View page source',
          icon: 'i-lucide-github',
          to: pageSourceUrl.value,
          target: '_blank',
        },
      ],
    },
  ];

  // On a project page, surface its tab panels in the palette — the fastest
  // keyboard path to each. The project page tolerates an unknown ?tab= by
  // falling back to Runs.
  if (currentProjectId.value) {
    const pid = currentProjectId.value;
    // Same order as the project page's tab strip.
    const projectTabs: [value: string, label: string, icon: string][] = [
      ['runs', 'Runs', 'i-lucide-play-circle'],
      ['tests', 'Tests', 'i-lucide-flask-conical'],
      ['failures', 'Failures', 'i-lucide-layers'],
      ['performance', 'Performance', 'i-lucide-trending-up'],
      ['settings', 'Settings', 'i-lucide-settings'],
    ];
    staticGroups.unshift({
      id: 'project-tabs',
      label: 'This project',
      items: projectTabs.map(([value, label, icon]) => ({
        id: `project-tab-${value}`,
        label,
        icon,
        to: `/projects/${pid}?tab=${value}`,
        onSelect: () => {
          open.value = false;
        },
      })),
    });
  }

  if (!searchResults.value) return staticGroups;

  const resultGroups: CommandPaletteGroup[] = [];

  if (searchResults.value.projects.length > 0) {
    resultGroups.push({
      id: 'search-projects',
      label: 'Projects',
      ignoreFilter: true,
      items: searchResults.value.projects.map((p) => ({
        id: `project-${p.id}`,
        label: p.label || p.name,
        description: p.label && p.label !== p.name ? p.name : undefined,
        icon: 'i-lucide-folder',
        to: `/projects/${p.id}`,
      })),
    });
  }

  if (searchResults.value.runs.length > 0) {
    resultGroups.push({
      id: 'search-runs',
      label: 'Test runs',
      ignoreFilter: true,
      items: searchResults.value.runs.map((r) => ({
        id: `run-${r.id}`,
        label: r.label ? `Run #${r.id} — ${r.label}` : `Run #${r.id}`,
        description: r.projectLabel || r.projectName,
        suffix: r.status,
        icon: runStatusIcon(r.status),
        to: `/test-runs/${r.id}`,
      })),
    });
  }

  if (searchResults.value.cases.length > 0) {
    resultGroups.push({
      id: 'search-cases',
      label: 'Tests',
      ignoreFilter: true,
      items: searchResults.value.cases.map((c) => ({
        id: `case-${c.id}`,
        label: c.title,
        description: `${c.projectLabel || c.projectName} · ${c.filePath}`,
        icon: 'i-lucide-flask-conical',
        to: `/test-cases/${c.id}`,
      })),
    });
  }

  return [...resultGroups, ...staticGroups];
});

const isDemo = config.public.demoMode;
const demoDataVersion = config.public.demoDataVersion as string;
const appVersion = config.public.appVersion as string;

const { resetDemo } = useDemoReset();

onMounted(async () => {
  // ── Demo data staleness ──
  // Note: the demo DB now self-heals on load — a changed seed version reseeds
  // automatically (see db.client `canReusePersistedDemoDb`). This prompt is a
  // belt-and-suspenders nudge; its "Refresh" runs the same window + service
  // worker reset the toolbar button uses.
  if (isDemo && demoDataVersion) {
    const stored = await getStoredDemoVersion();
    if (stored !== null && stored !== demoDataVersion) {
      toast.add({
        title: 'New demo data available',
        description:
          'The demo seed data has been updated since your last visit. Click "Refresh" to reload with the latest data.',
        duration: 0,
        color: 'warning',
        actions: [
          {
            label: 'Refresh',
            color: 'warning',
            onClick: () => {
              resetDemo();
            },
          },
          {
            label: 'Dismiss',
            color: 'neutral',
            variant: 'ghost',
          },
        ],
      });
    }
  }
});
</script>

<template>
  <UDashboardGroup
    unit="rem"
    style="top: var(--demo-banner-height, 0px); height: calc(100dvh - var(--demo-banner-height, 0px))"
  >
    <!-- Keyboard skip link: first Tab stop, lets keyboard/AT users jump past the sidebar. -->
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-inverted focus:shadow-lg focus:outline-2 focus:outline-primary"
    >
      Skip to main content
    </a>

    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      width="20"
      class="bg-elevated/25"
      :ui="{ root: 'min-h-full', footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <!-- Desktop shell only: visible back/forward for the chrome-less webview,
             paired at the top-left corner the way native apps place them. The
             collapsed rail has no room in the header row, so the pair moves into
             the rail stack below instead. -->
        <DesktopNavButtons v-if="!collapsed" />
        <div class="flex-1 min-w-0">
          <ProjectsMenu :collapsed="collapsed" />
        </div>
      </template>

      <template #default="{ collapsed }">
        <DesktopNavButtons v-if="collapsed" collapsed class="self-center" />

        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <UNavigationMenu
          :key="currentProjectId ?? undefined"
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
          popover
        />

        <UNavigationMenu :collapsed="collapsed" :items="links[1]" orientation="vertical" tooltip class="mt-auto" />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex flex-col gap-1 w-full">
          <DesktopLocalRunsIndicator :collapsed="collapsed" />
          <UserMenu :collapsed="collapsed" />
          <ULink
            v-if="!collapsed"
            to="/settings/about"
            class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-center"
            title="View version and build info"
          >
            v{{ appVersion }}
          </ULink>
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardSearch v-model:search-term="searchTerm" :groups="groups" :preserve-group-order="!!searchResults" />

    <!-- The real main landmark the skip link targets. Fills the group's content
         area so the page panel keeps its full width/height. -->
    <main id="main-content" tabindex="-1" class="flex-1 min-w-0 flex flex-col outline-none">
      <slot />
    </main>

    <!-- Global "Open in IDE" settings modal, toggled from file-path choosers and the user menu -->
    <OpenInIdeSettingsModal />

    <!-- Desktop shell: import dialog for archives dropped on the window or opened with the app -->
    <DesktopImportModal />

    <!-- Desktop shell: after linking a folder, offer to import the runs already in it -->
    <DesktopImportPreviousRunsModal />

    <!-- Desktop shell: the Local runs tray — local test runs keep streaming here across navigation -->
    <DesktopLocalRunsTray />
  </UDashboardGroup>
</template>
