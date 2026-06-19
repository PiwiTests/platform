<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui';
import type { ProjectWithStats } from '~~/types/api';
import ProjectsMenu from '~/components/layout/ProjectsMenu.vue';
import { getStoredDemoVersion, resetDemoDb } from '~/demo/db.client';

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
const { data: projects, refresh: refreshProjects } = await useFetch<ProjectWithStats[]>('/api/projects', {
  key: 'projects',
  lazy: true,
  default: () => [] as ProjectWithStats[],
});

useRunStream(refreshProjects);

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
    const isRunning = project.latestRun?.status === 'running' || project.latestRun?.status === 'initialising';
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
      type: 'trigger' as const,
      defaultOpen: isActive,
      active: isActive,
      children: [
        {
          label: 'Test runs',
          icon: 'i-lucide-play-circle',
          to: `/projects/${project.id}`,
          badge: String(project.totalRuns || 0),
          onSelect: () => {
            open.value = false;
          },
        },
        {
          label: 'Test cases',
          icon: 'i-lucide-list-checks',
          to: `/projects/${project.id}/test-cases`,
          badge: String(project.totalTestCases || 0),
          onSelect: () => {
            open.value = false;
          },
        },
        {
          label: 'Performance',
          icon: 'i-lucide-gauge',
          to: `/projects/${project.id}/performance`,
          onSelect: () => {
            open.value = false;
          },
        },
        {
          label: 'Edit project',
          icon: 'i-lucide-edit',
          to: `/projects/${project.id}/edit`,
          onSelect: () => {
            open.value = false;
          },
        },
      ],
      onSelect: () => {
        // Do nothing - allow children to be shown
      },
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
      to: 'https://github.com/PhenX/piwi-dashboard',
      target: '_blank',
    },
  ];
  if (!isDemo) {
    bottomLinks.unshift({
      label: 'API Docs',
      icon: 'i-lucide-book-open',
      to: '/docs',
      // `/docs` is served by Nitro (Scalar UI), not a Nuxt page — force a full
      // page navigation so the client router doesn't intercept it and 404.
      external: true,
      onSelect: () => {
        open.value = false;
      },
    });
  }
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
  const blobBase = 'https://github.com/PhenX/piwi-dashboard/blob/main/application/app/pages';
  const treeBase = 'https://github.com/PhenX/piwi-dashboard/tree/main/application/app/pages';
  const pattern = route.matched[route.matched.length - 1]?.path ?? route.path;
  if (pattern.includes(':')) return treeBase;
  return `${blobBase}${pattern === '/' ? '/index' : pattern}.vue`;
});

function runStatusIcon(status: string) {
  if (status === 'passed') return 'i-lucide-circle-check-big';
  if (status === 'failed') return 'i-lucide-circle-x';
  if (status === 'running' || status === 'initialising') return 'i-lucide-loader-circle';
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
      label: 'Test cases',
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

onMounted(async () => {
  // ── Demo data staleness ──
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
              resetDemoDb().then(() => window.location.reload());
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
        <ProjectsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
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
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch v-model:search-term="searchTerm" :groups="groups" :preserve-group-order="!!searchResults" />

    <slot />
  </UDashboardGroup>
</template>
