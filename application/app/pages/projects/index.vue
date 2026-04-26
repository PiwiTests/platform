<script setup lang="ts">
import { h, resolveComponent, computed, ref } from 'vue'
import { z } from 'zod'
import type { TableColumn } from '@nuxt/ui'
import type { ProjectWithStats, TagInfo, TagsResponse } from '~~/types/api'
import { formatDuration } from '~/utils'

useHead({ title: 'Projects — Playwright Dashboard' })

const { data: projects, refresh } = await useFetch<ProjectWithStats[]>('/api/projects')
const { data: tagsData, refresh: refreshTags } = await useFetch<TagsResponse>('/api/tags')
const toast = useToast()

const allTags = computed(() => tagsData.value?.tags || [])

// Search and filter state
const searchQuery = ref('')
const selectedTagIds = ref<number[]>([])

const filteredProjects = computed(() => {
  let result = projects.value || []

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(p =>
      (p.label || p.name).toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    )
  }

  if (selectedTagIds.value.length > 0) {
    result = result.filter(p =>
      selectedTagIds.value.every(tagId =>
        (p.tags || []).some(t => t.id === tagId)
      )
    )
  }

  return result
})

function toggleTagFilter(tagId: number) {
  const idx = selectedTagIds.value.indexOf(tagId)
  if (idx === -1) {
    selectedTagIds.value.push(tagId)
  } else {
    selectedTagIds.value.splice(idx, 1)
  }
}

function isTagFilterActive(tagId: number) {
  return selectedTagIds.value.includes(tagId)
}

// New Project modal
const isNewProjectModalOpen = ref(false)
const newProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  label: z.string().optional(),
  description: z.string().optional()
})
type NewProjectSchema = z.output<typeof newProjectSchema>
const newProject = reactive<Partial<NewProjectSchema>>({
  name: '',
  label: '',
  description: ''
})
const newProjectTags = ref<TagInfo[]>([])
const creatingProject = ref(false)

async function handleCreateProject() {
  if (!newProject.name?.trim()) return
  try {
    creatingProject.value = true
    await $fetch('/api/projects', {
      method: 'POST',
      body: {
        name: newProject.name.trim(),
        label: newProject.label?.trim() || null,
        description: newProject.description?.trim() || null,
        tagIds: newProjectTags.value.map(t => t.id)
      }
    })

    toast.add({
      title: 'Project created',
      description: `Project "${newProject.name}" has been created`,
      color: 'success'
    })

    isNewProjectModalOpen.value = false
    newProject.name = ''
    newProject.label = ''
    newProject.description = ''
    newProjectTags.value = []

    await refresh()
  } catch (error: unknown) {
    const errorMessage = error && typeof error === 'object' && 'data' in error
      ? (error.data as { message?: string })?.message
      : undefined
    toast.add({
      title: 'Failed to create project',
      description: errorMessage || 'An error occurred',
      color: 'error'
    })
  } finally {
    creatingProject.value = false
  }
}

const TagBadge = resolveComponent('TagBadge')
const UBadge = resolveComponent('UBadge')
const TestStatusBar = resolveComponent('TestStatusBar')
const RunReports = resolveComponent('RunReports')

const noData = h('span', { class: 'text-xs text-gray-600 italic' }, 'No data')

const columns: TableColumn<ProjectWithStats>[] = [
  {
    accessorKey: 'name',
    header: createSortHeader<ProjectWithStats>('Project name'),
    cell: ({ row }) => {
      const displayName = (row.original.label || row.getValue('name')) as string
      const tags = (row.original.tags || []) as TagInfo[]

      return h('div', { class: 'flex flex-col gap-1' }, [
        h('div', { class: 'flex items-center gap-2' }, [
          h('a', {
            href: `/projects/${row.original.id}`,
            class: 'text-primary hover:underline font-medium text-lg',
            onClick: (e: MouseEvent) => {
              e.preventDefault()
              navigateTo(`/projects/${row.original.id}`)
            }
          }, displayName)
        ]),
        tags.length > 0
          ? h('div', { class: 'flex flex-wrap gap-1' },
              tags.map(tag =>
                h(TagBadge, { text: tag.text, color: tag.color })
              )
            )
          : null
      ].filter(Boolean))
    }
  },
  {
    accessorKey: 'totalRuns',
    header: createSortHeader<ProjectWithStats>('Test runs'),
    cell: ({ row }) => {
      const totalRuns = row.getValue('totalRuns') as ProjectWithStats['totalRuns']

      if (totalRuns === 0) {
        return noData
      }

      return `${totalRuns} runs`
    }
  },
  {
    accessorKey: 'latestRun',
    header: createSortHeader<ProjectWithStats>('Last run'),
    cell: ({ row }) => {
      const latestRun = row.getValue('latestRun') as ProjectWithStats['latestRun']
      return latestRun ? formatDate(latestRun.startTime) : noData
    }
  },
  {
    accessorKey: 'duration',
    header: createSortHeader<ProjectWithStats>('Duration'),
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      return latestRun?.duration != null ? formatDuration(latestRun.duration) : noData
    }
  },
  {
    accessorKey: 'status',
    header: createSortHeader<ProjectWithStats>('Status'),
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      if (!latestRun) return noData

      const color = getStatusColor(latestRun.status)
      return h(UBadge, { color, size: 'md', class: 'capitalize' }, () => latestRun.status)
    }
  },
  {
    accessorKey: 'testRatio',
    header: 'Test status',
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      if (!latestRun) return noData

      return h(TestStatusBar, {
        passed: latestRun.passedTests,
        failed: latestRun.failedTests,
        skipped: latestRun.skippedTests,
        flaky: latestRun.flakyTests,
        total: latestRun.totalTests
      })
    }
  },
  {
    accessorKey: 'report',
    header: 'Reports',
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      if (!latestRun) return ''
      return h(RunReports, {
        reports: latestRun.reports,
        legacyPath: latestRun.reportPath,
        legacySize: latestRun.reportSize
      })
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => {
      const UButton = resolveComponent('UButton')
      return h('div', { class: 'flex justify-end gap-2' }, [
        h(UButton, {
          to: `/projects/${row.original.id}`,
          size: 'sm',
          variant: 'outline'
        }, () => 'View details'),
        h(UButton, {
          to: `/projects/${row.original.id}/edit`,
          size: 'sm',
          variant: 'ghost',
          icon: 'i-lucide-pencil'
        }, () => 'Edit')
      ])
    }
  }
]
</script>

<template>
  <UDashboardPanel id="projects">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Home', icon: 'i-lucide-house', to: '/' }, { label: 'Projects' }]" />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-plus"
            size="md"
            label="New project"
            @click="isNewProjectModalOpen = true"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            size="md"
            label="Refresh"
            variant="outline"
            @click="() => refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Search and filter toolbar -->
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="Search projects by name..."
          class="min-w-48 flex-1"
          :ui="{ base: 'w-full' }"
        />

        <div v-if="allTags.length > 0" class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted shrink-0">Filter by tag:</span>
          <button
            v-for="tag in allTags"
            :key="tag.id"
            type="button"
            class="cursor-pointer focus:outline-none"
            @click="toggleTagFilter(tag.id)"
          >
            <TagBadge
              :text="tag.text"
              :color="tag.color"
              :variant="isTagFilterActive(tag.id) ? 'solid' : 'outline'"
            />
          </button>

          <UButton
            v-if="selectedTagIds.length > 0"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            label="Clear filters"
            @click="selectedTagIds = []"
          />
        </div>
      </div>

      <UTable
        v-if="filteredProjects.length > 0"
        :data="filteredProjects"
        :columns="columns"
        :ui="{
          base: 'table-fixed border-separate border-spacing-0',
          thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
          tbody: '[&>tr]:last:[&>td]:border-b-0',
          th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
          td: 'border-b border-default'
        }"
      />

      <div v-else-if="projects && projects.length > 0" class="text-center py-12 text-gray-500">
        <p class="text-lg mb-2">
          No projects match your search
        </p>
        <p class="text-sm">
          Try adjusting your search or filters
        </p>
      </div>

      <div v-else class="text-center py-12 text-gray-500">
        <p class="text-lg mb-2">
          No projects yet
        </p>
        <p class="text-sm mb-4">
          Submit test results via the API, or create a project manually
        </p>
        <UButton
          icon="i-lucide-plus"
          label="New project"
          @click="isNewProjectModalOpen = true"
        />
      </div>
    </template>
  </UDashboardPanel>

  <!-- New Project Modal -->
  <ClientOnly>
    <UModal :open="isNewProjectModalOpen" title="Create new project" @update:open="isNewProjectModalOpen = $event">
      <template #body>
        <UForm :schema="newProjectSchema" :state="newProject">
          <UFormField
            label="Project name"
            name="name"
            required
            description="A unique identifier used to match test results from the reporter."
            class="mb-4"
          >
            <UInput v-model="newProject.name" placeholder="e.g. my-app" />
          </UFormField>

          <UFormField
            label="Display label"
            name="label"
            description="A friendly name shown in the UI (defaults to project name if not set)."
            class="mb-4"
          >
            <UInput v-model="newProject.label" placeholder="e.g. My Application" />
          </UFormField>

          <UFormField
            label="Description"
            name="description"
            description="Optional description of this project."
          >
            <UTextarea v-model="newProject.description" placeholder="Enter project description" :rows="3" />
          </UFormField>

          <UFormField
            label="Tags"
            name="tags"
            description="Select existing tags or type a new name and press Enter to create one."
            class="mt-4"
          >
            <TagsSelect
              v-model="newProjectTags"
              :all-tags="allTags"
              @tag-created="refreshTags()"
            />
          </UFormField>
        </UForm>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="isNewProjectModalOpen = false"
        />
        <UButton
          label="Create project"
          icon="i-lucide-plus"
          :loading="creatingProject"
          @click="handleCreateProject"
        />
      </template>
    </UModal>
  </ClientOnly>
</template>
