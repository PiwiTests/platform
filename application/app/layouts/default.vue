<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import type { ProjectWithStats } from '~~/types/api'
import ProjectsMenu from '~/components/ProjectsMenu.vue'
import { getStoredDemoVersion, resetDemoDb } from '~/demo/db.client'

const route = useRoute()
const toast = useToast()
const config = useRuntimeConfig()

const open = ref(false)

// Fetch projects for sidebar navigation
const { data: projects, refresh: refreshProjects } = await useFetch<ProjectWithStats[]>('/api/projects', {
  lazy: true,
  default: () => []
})

useRunStream(refreshProjects)

// Extract current project ID from route (if viewing a project page)
const currentProjectId = computed(() => {
  // Check if route path starts with /projects/:id
  const match = route.path.match(/^\/projects\/(\d+)/)
  return match?.[1] ? parseInt(match[1], 10) : null
})

// Generate project navigation items with children
const ACTIVE_WINDOW_DAYS = 10

const projectItems = computed<NavigationMenuItem[]>(() => {
  if (!projects.value || projects.value.length === 0) {
    return []
  }

  const activeThreshold = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000

  // Sort alphabetically by display label
  const sorted = [...projects.value].sort((a, b) => {
    const labelA = (a.label || a.name).toLowerCase()
    const labelB = (b.label || b.name).toLowerCase()
    return labelA.localeCompare(labelB)
  })

  // Split into active and others
  const active = sorted.filter(p =>
    p.latestRun && new Date(p.latestRun.startTime).getTime() > activeThreshold
  )
  const others = sorted.filter(p =>
    !p.latestRun || new Date(p.latestRun.startTime).getTime() <= activeThreshold
  )

  function buildProjectItem(project: ProjectWithStats): NavigationMenuItem {
    const isActive = currentProjectId.value !== null && currentProjectId.value === project.id
    const isRunning = project.latestRun?.status === 'running' || project.latestRun?.status === 'initialising'
    const status = project.latestRun?.status || 'unknown'
    const statusIcon = status === 'passed' ? 'i-lucide-circle-check-big' : status === 'failed' ? 'i-lucide-circle-x' : 'i-lucide-circle'
    const statusColor = status === 'passed' ? 'success' : status === 'failed' ? 'error' : isRunning ? 'info' : 'neutral'
    const displayLabel = project.label || project.name

    return {
      label: displayLabel,
      icon: isRunning ? 'i-lucide-loader-circle' : 'i-lucide-circle',
      ui: isRunning ? { linkLeadingIcon: 'animate-spin' } : undefined,
      badge: {
        icon: statusIcon,
        color: statusColor as 'success' | 'error' | 'info' | 'neutral'
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
            open.value = false
          }
        },
        {
          label: 'Test cases',
          icon: 'i-lucide-list-checks',
          to: `/projects/${project.id}/test-cases`,
          badge: String(project.totalTestCases || 0),
          onSelect: () => {
            open.value = false
          }
        },
        {
          label: 'Performance',
          icon: 'i-lucide-gauge',
          to: `/projects/${project.id}/performance`,
          onSelect: () => {
            open.value = false
          }
        },
        {
          label: 'Edit project',
          icon: 'i-lucide-edit',
          to: `/projects/${project.id}/edit`,
          onSelect: () => {
            open.value = false
          }
        }
      ],
      onSelect: () => {
        // Do nothing - allow children to be shown
      }
    }
  }

  const items: NavigationMenuItem[] = []

  if (active.length > 0) {
    items.push({
      label: `Active (${active.length})`,
      type: 'label'
    })
    items.push(...active.map(buildProjectItem))
  }

  if (others.length > 0) {
    items.push({
      label: `Others (${others.length})`,
      type: 'label'
    })
    items.push(...others.map(buildProjectItem))
  }

  return items
})

const links = computed(() => [[{
  label: 'Home',
  icon: 'i-lucide-house',
  to: '/',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Projects',
  icon: 'i-lucide-folder',
  to: '/projects',
  onSelect: () => {
    open.value = false
  }
}, ...projectItems.value], [{
  label: 'Documentation',
  icon: 'i-lucide-book',
  to: 'https://github.com/PhenX/piwi-dashboard',
  target: '_blank'
}]] satisfies NavigationMenuItem[][])

const toCommandPaletteItem = (item: NavigationMenuItem): CommandPaletteItem => ({
  label: typeof item.label === 'string' ? item.label : undefined,
  icon: item.icon,
  to: item.to,
  target: item.target,
  active: item.active,
  disabled: item.disabled,
  suffix: typeof item.badge === 'string' ? item.badge : undefined,
  children: item.children?.map(child => toCommandPaletteItem(child)),
  onSelect: item.onSelect
})

// The source file for a dynamic route (e.g. /projects/:id) can't be derived
// from the URL — it may be `[id].vue` or `[id]/index.vue` — so for dynamic
// routes we link to the pages directory instead of a guessed (404-ing) file.
const pageSourceUrl = computed(() => {
  const blobBase = 'https://github.com/PhenX/piwi-dashboard/blob/main/application/app/pages'
  const treeBase = 'https://github.com/PhenX/piwi-dashboard/tree/main/application/app/pages'
  const pattern = route.matched[route.matched.length - 1]?.path ?? route.path
  if (pattern.includes(':')) return treeBase
  return `${blobBase}${pattern === '/' ? '/index' : pattern}.vue`
})

const groups = computed<CommandPaletteGroup[]>(() => [{
  id: 'links',
  label: 'Go to',
  items: links.value.flat().map(item => toCommandPaletteItem(item))
}, {
  id: 'code',
  label: 'Code',
  items: [{
    id: 'source',
    label: 'View page source',
    icon: 'i-lucide-github',
    to: pageSourceUrl.value,
    target: '_blank'
  }]
}])

const isDemo = config.public.demoMode
const demoDataVersion = config.public.demoDataVersion as string

onMounted(async () => {
  // ── Cookie consent ──
  const cookie = useCookie('cookie-consent')
  if (cookie.value !== 'accepted' && cookie.value !== 'opted-out') {
    const notification = toast.add({
      title: 'We use first-party cookies to enhance your experience on our website.',
      duration: 0,
      close: false,
      actions: [{
        label: 'Accept',
        color: 'neutral',
        variant: 'outline',
        onClick: () => {
          cookie.value = 'accepted'
          toast.remove(notification.id)
        }
      }, {
        label: 'Opt out',
        color: 'neutral',
        variant: 'ghost',
        onClick: () => {
          cookie.value = 'opted-out'
          toast.remove(notification.id)
        }
      }]
    })
  }

  // ── Demo data staleness ──
  if (isDemo && demoDataVersion) {
    const stored = await getStoredDemoVersion()
    if (stored !== null && stored !== demoDataVersion) {
      toast.add({
        title: 'New demo data available',
        description: 'The demo seed data has been updated since your last visit. Click "Refresh" to reload with the latest data.',
        duration: 0,
        color: 'warning',
        actions: [{
          label: 'Refresh',
          color: 'warning',
          onClick: () => {
            resetDemoDb().then(() => window.location.reload())
          }
        }, {
          label: 'Dismiss',
          color: 'neutral',
          variant: 'ghost'
        }]
      })
    }
  }
})
</script>

<template>
  <UDashboardGroup unit="rem" style="top: var(--demo-banner-height, 0px)">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      width="20"
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <ProjectsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <UNavigationMenu
          :key="currentProjectId"
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
          popover
        />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[1]"
          orientation="vertical"
          tooltip
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />
  </UDashboardGroup>
</template>
