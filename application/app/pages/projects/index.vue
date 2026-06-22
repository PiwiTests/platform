<script setup lang="ts">
import { computed, ref } from 'vue';
import { z } from 'zod';
import type { TableColumn } from '@nuxt/ui';
import type { ProjectWithStats, TagInfo, TagsResponse } from '~~/types/api';

useHead({ title: 'Projects — Piwi Dashboard' });

// Share the projects data already fetched by the layout (same key → single HTTP request, single SSE subscription)
const { data: projects, refresh } = await useFetch<ProjectWithStats[]>('/api/projects', { key: 'projects' });
const { data: tagsData, refresh: refreshTags } = await useFetch<TagsResponse>('/api/tags');
const toast = useToast();

const allTags = computed(() => tagsData.value?.tags || []);

// Search and filter state
const searchQuery = ref('');
const selectedTagIds = ref<number[]>([]);

const filteredProjects = computed(() => {
  let result = projects.value || [];

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    result = result.filter((p) => (p.label || p.name).toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }

  if (selectedTagIds.value.length > 0) {
    result = result.filter((p) => selectedTagIds.value.some((tagId) => (p.tags || []).some((t) => t.id === tagId)));
  }

  return result;
});

function toggleTagFilter(tagId: number) {
  const idx = selectedTagIds.value.indexOf(tagId);
  if (idx === -1) {
    selectedTagIds.value.push(tagId);
  } else {
    selectedTagIds.value.splice(idx, 1);
  }
}

function isTagFilterActive(tagId: number) {
  return selectedTagIds.value.includes(tagId);
}

// New Project modal
const isNewProjectModalOpen = ref(false);
const newProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  label: z.string().optional(),
  description: z.string().optional(),
});
type NewProjectSchema = z.output<typeof newProjectSchema>;
const newProject = reactive<Partial<NewProjectSchema>>({
  name: '',
  label: '',
  description: '',
});
const newProjectTags = ref<TagInfo[]>([]);
const creatingProject = ref(false);

async function handleCreateProject() {
  if (!newProject.name?.trim()) return;
  try {
    creatingProject.value = true;
    await $fetch('/api/projects', {
      method: 'POST',
      body: {
        name: newProject.name.trim(),
        label: newProject.label?.trim() || null,
        description: newProject.description?.trim() || null,
        tagIds: newProjectTags.value.map((t) => t.id),
      },
    });

    toast.add({
      title: 'Project created',
      description: `Project "${newProject.name}" has been created`,
      color: 'success',
    });

    isNewProjectModalOpen.value = false;
    newProject.name = '';
    newProject.label = '';
    newProject.description = '';
    newProjectTags.value = [];

    await refresh();
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({
      title: 'Failed to create project',
      description: errorMessage || 'An error occurred',
      color: 'error',
    });
  } finally {
    creatingProject.value = false;
  }
}

const columns: TableColumn<ProjectWithStats>[] = [
  {
    header: 'Project',
    columns: [
      {
        accessorKey: 'name',
        header: createSortHeader<ProjectWithStats>('Name'),
      },
      {
        accessorKey: 'totalRuns',
        header: createSortHeader<ProjectWithStats>('Runs'),
      },
    ],
  },
  {
    accessorKey: 'latestRunData',
    header: 'Latest run',
    columns: [
      {
        accessorKey: 'latestRun',
        header: createSortHeader<ProjectWithStats>('Date'),
      },
      {
        accessorKey: 'branch',
        header: 'Branch',
      },

      {
        accessorKey: 'duration',
        header: createSortHeader<ProjectWithStats>('Duration'),
      },
      {
        accessorKey: 'status',
        header: createSortHeader<ProjectWithStats>('Status'),
      },
      {
        accessorKey: 'testRatio',
        header: 'Test status',
      },
      {
        accessorKey: 'report',
        header: 'Reports',
      },
    ],
  },
  {
    accessorKey: 'actions',
    header: 'Project actions',
  },
];
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
          <UButton icon="i-lucide-plus" size="md" label="New project" @click="isNewProjectModalOpen = true" />
          <UButton icon="i-lucide-refresh-cw" size="md" label="Refresh" variant="outline" @click="() => refresh()" />
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
          <span class="text-sm text-muted shrink-0">Filter by tag (any match):</span>
          <button
            v-for="tag in allTags"
            :key="tag.id"
            type="button"
            class="cursor-pointer focus:outline-none"
            @click="toggleTagFilter(tag.id)"
          >
            <TagBadge :text="tag.text" :color="tag.color" :variant="isTagFilterActive(tag.id) ? 'solid' : 'outline'" />
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
          td: 'border-b border-default',
        }"
      >
        <template #name-cell="{ row }">
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <NuxtLink :to="`/projects/${row.original.id}`" class="text-primary hover:underline font-medium">
                {{ row.original.label || row.original.name }}
              </NuxtLink>
            </div>
            <div v-if="row.original.tags?.length" class="flex flex-wrap gap-1">
              <TagBadge v-for="tag in row.original.tags" :key="tag.id" :text="tag.text" :color="tag.color" />
            </div>
          </div>
        </template>
        <template #totalRuns-cell="{ row }">
          <span v-if="row.original.totalRuns === 0" class="text-xs text-gray-600 italic">No data</span>
          <span v-else>{{ row.original.totalRuns }} runs</span>
        </template>
        <template #latestRun-cell="{ row }">
          <span v-if="row.original.latestRun" class="text-xs text-gray-600">{{
            prettyDateFormat(row.original.latestRun.startTime)
          }}</span>
          <span v-else class="text-xs text-gray-600 italic">No data</span>
        </template>
        <template #branch-cell="{ row }">
          <div v-if="row.original.latestRun?.metadata?.scm" class="flex items-center gap-1 flex-wrap">
            <span
              v-if="row.original.latestRun.metadata.scm.branch"
              class="text-xs font-medium bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded"
            >
              {{ row.original.latestRun.metadata.scm.branch }}
            </span>
            <code v-if="row.original.latestRun.metadata.scm.commit" class="text-xs text-gray-500">
              {{ row.original.latestRun.metadata.scm.commit.substring(0, 7) }}
            </code>
          </div>
        </template>
        <template #duration-cell="{ row }">
          <span v-if="row.original.latestRun?.duration != null" class="text-sm text-gray-600">{{
            formatDuration(row.original.latestRun.duration)
          }}</span>
          <span v-else class="text-xs text-gray-600 italic">No data</span>
        </template>
        <template #status-cell="{ row }">
          <RunStatusBadge v-if="row.original.latestRun" :status="row.original.latestRun.status" />
          <span v-else class="text-xs text-gray-600 italic">No data</span>
        </template>
        <template #testRatio-cell="{ row }">
          <TestStatusBar
            v-if="row.original.latestRun"
            :passed="row.original.latestRun.passedTests"
            :failed="row.original.latestRun.failedTests"
            :skipped="row.original.latestRun.skippedTests"
            :flaky="row.original.latestRun.flakyTests"
            :total="row.original.latestRun.totalTests"
          />
          <span v-else class="text-xs text-gray-600 italic">No data</span>
        </template>
        <template #report-cell="{ row }">
          <RunReports v-if="row.original.latestRun" :reports="row.original.latestRun.reports" />
        </template>
        <template #actions-header>
          <div class="text-right">Project actions</div>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-2">
            <UButton :to="`/projects/${row.original.id}`" size="sm" variant="outline">View details</UButton>
            <UButton :to="`/projects/${row.original.id}/edit`" size="sm" variant="ghost" icon="i-lucide-pencil" />
          </div>
        </template>
      </UTable>

      <div v-else-if="projects && projects.length > 0" class="text-center py-12 text-gray-500">
        <p class="text-lg mb-2">No projects match your search</p>
        <p class="text-sm">Try adjusting your search or filters</p>
      </div>

      <div v-else class="text-center py-12 text-gray-500">
        <p class="text-lg mb-2">No projects yet</p>
        <p class="text-sm mb-4">Submit test results via the API, or create a project manually</p>
        <UButton icon="i-lucide-plus" label="New project" @click="isNewProjectModalOpen = true" />
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

          <UFormField label="Description" name="description" description="Optional description of this project.">
            <UTextarea v-model="newProject.description" placeholder="Enter project description" :rows="3" />
          </UFormField>

          <UFormField
            label="Tags"
            name="tags"
            description="Select existing tags or type a new name and press Enter to create one."
            class="mt-4"
          >
            <TagsSelect v-model="newProjectTags" :all-tags="allTags" @tag-created="refreshTags()" />
          </UFormField>
        </UForm>
      </template>

      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="isNewProjectModalOpen = false" />
        <UButton label="Create project" icon="i-lucide-plus" :loading="creatingProject" @click="handleCreateProject" />
      </template>
    </UModal>
  </ClientOnly>
</template>
