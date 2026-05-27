<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ProjectWithStats } from '~~/types/api'

defineProps<{
  collapsed?: boolean
}>()

const route = useRoute()
const router = useRouter()

// Fetch available projects
const { data: projects, refresh } = await useFetch<ProjectWithStats[]>('/api/projects')

useRunStream(refresh)

// Get current project from route
const currentProjectId = computed(() => {
  const id = route.params.id
  return id ? parseInt(id as string) : null
})

// Find the selected project
const selectedProject = computed(() => {
  if (!currentProjectId.value || !projects.value) {
    return {
      label: 'All projects',
      icon: 'i-lucide-folder-open',
      loading: false
    }
  }

  const project = projects.value.find(p => p.id === currentProjectId.value)
  const isActive = project?.latestRun?.status === 'running' || project?.latestRun?.status === 'initialising'
  return project
    ? {
        label: project.label || project.name,
        icon: isActive ? undefined : 'i-lucide-folder',
        loading: isActive
      }
    : {
        label: 'All projects',
        icon: 'i-lucide-folder-open',
        loading: false
      }
})

// Create dropdown items
const items = computed<DropdownMenuItem[][]>(() => {
  const projectItems: DropdownMenuItem[] = [{
    label: 'All projects',
    icon: 'i-lucide-folder-open',
    onSelect() {
      router.push('/projects')
    }
  }]

  if (projects.value && projects.value.length > 0) {
    projectItems.push(...projects.value.map(project => {
      const isActive = project.latestRun?.status === 'running' || project.latestRun?.status === 'initialising'
      return {
        label: project.label || project.name,
        icon: isActive ? undefined : 'i-lucide-folder',
        loading: isActive,
        onSelect() {
          router.push(`/projects/${project.id}`)
        }
      }
    }))
  }

  return [projectItems]
})

// Refresh projects when route changes
watch(() => route.path, () => {
  refresh()
})
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-40' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      v-bind="{
        ...selectedProject,
        label: collapsed ? undefined : selectedProject?.label,
        trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
      }"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :class="[!collapsed && 'py-2']"
      :ui="{
        trailingIcon: 'text-dimmed'
      }"
    />
  </UDropdownMenu>
</template>
