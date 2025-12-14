<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import ProjectsMenu from '~/components/ProjectsMenu.vue'

interface Project {
  id: number
  name: string
  label?: string
  description?: string
  totalRuns: number
  totalTestCases: number
  latestRun?: {
    id: number
    status: string
    startTime: string
  }
}

const route = useRoute()
const toast = useToast()

const open = ref(false)

// Fetch projects for sidebar navigation
const { data: projects } = await useFetch<Project[]>('/api/projects', {
  lazy: true,
  default: () => []
})

// Extract current project ID from route (if viewing a project page)
const currentProjectId = computed(() => {
  // Check if route path starts with /projects/:id
  const match = route.path.match(/^\/projects\/(\d+)/)
  return match?.[1] ? parseInt(match[1], 10) : null
})

// Generate project navigation items with children
const projectItems = computed(() => {
  if (!projects.value || projects.value.length === 0) {
    return []
  }

  return projects.value.map((project) => {
    const isActive = currentProjectId.value !== null && currentProjectId.value === project.id
    const status = project.latestRun?.status || 'unknown'
    const statusIcon = status === 'passed' ? 'i-lucide-circle-check-big' : status === 'failed' ? 'i-lucide-circle-x' : 'i-lucide-circle'
    const statusColor = status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'neutral'
    const displayLabel = project.label || project.name

    return {
      label: displayLabel,
      icon: 'i-lucide-circle',
      badge: {
        icon: statusIcon,
        color: statusColor as 'success' | 'error' | 'neutral'
      },
      value: `project-${project.id}`,
      type: 'trigger' as const,
      defaultOpen: isActive,
      active: isActive,
      children: [
        {
          label: 'Test Runs',
          icon: 'i-lucide-play-circle',
          to: `/projects/${project.id}`,
          badge: String(project.totalRuns || 0),
          onSelect: () => {
            open.value = false
          }
        },
        {
          label: 'Test Cases',
          icon: 'i-lucide-list-checks',
          to: `/projects/${project.id}/test-cases`,
          badge: String(project.totalTestCases || 0),
          onSelect: () => {
            open.value = false
          }
        }
      ],
      onSelect: () => {
        // Do nothing - allow children to be shown
      }
    }
  })
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
  to: 'https://github.com/PhenX/playwright-dashboard',
  target: '_blank'
}]] satisfies NavigationMenuItem[][])

const groups = computed(() => [{
  id: 'links',
  label: 'Go to',
  items: links.value.flat()
}, {
  id: 'code',
  label: 'Code',
  items: [{
    id: 'source',
    label: 'View page source',
    icon: 'i-lucide-github',
    to: `https://github.com/nuxt-ui-templates/dashboard/blob/main/app/pages${route.path === '/' ? '/index' : route.path}.vue`,
    target: '_blank'
  }]
}])

onMounted(async () => {
  const cookie = useCookie('cookie-consent')
  if (cookie.value === 'accepted') {
    return
  }

  toast.add({
    title: 'We use first-party cookies to enhance your experience on our website.',
    duration: 0,
    close: false,
    actions: [{
      label: 'Accept',
      color: 'neutral',
      variant: 'outline',
      onClick: () => {
        cookie.value = 'accepted'
      }
    }, {
      label: 'Opt out',
      color: 'neutral',
      variant: 'ghost'
    }]
  })
})
</script>

<template>
  <UDashboardGroup unit="rem">
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
