<script setup lang="ts">
import { z } from 'zod'
import type { ProjectDetails, TagsResponse, TagInfo } from '~~/types/api'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const projectId = route.params.id

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`)
const { data: tagsData, refresh: refreshTags } = await useFetch<TagsResponse>('/api/tags')

useHead(computed(() => ({ title: `Edit ${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard` })))

const allTags = computed(() => tagsData.value?.tags || [])

const state = ref({
  label: project.value?.label || '',
  description: project.value?.description || '',
  diagnosisInstructions: project.value?.diagnosisInstructions || ''
})

const selectedTags = ref<TagInfo[]>(project.value?.tags || [])

const schema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  diagnosisInstructions: z.string().optional()
})

const saving = ref(false)

async function onSubmit() {
  try {
    saving.value = true

    await $fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      body: {
        label: state.value.label || null,
        description: state.value.description || null,
        diagnosisInstructions: state.value.diagnosisInstructions || null,
        tagIds: selectedTags.value.map(t => t.id)
      }
    })

    toast.add({
      title: 'Project updated',
      description: 'Project settings have been saved successfully',
      color: 'success'
    })

    await router.push(`/projects/${projectId}`)
  } catch (error) {
    console.error('Error updating project:', error)
    toast.add({
      title: 'Error',
      description: 'Failed to update project',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

function onCancel() {
  router.push(`/projects/${projectId}`)
}
</script>

<template>
  <UDashboardPanel id="project-edit">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Edit' }
            ]"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <UCard>
          <template #header>
            <h2>
              Edit project settings
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Project Name: <span class="font-medium">{{ project?.name }}</span>
            </p>
            <p class="text-xs text-gray-500 mt-1">
              Note: The project name is used to match test results from the reporter and cannot be changed.
            </p>
          </template>

          <UForm
            :schema="schema"
            :state="state"
            class="space-y-4"
            @submit="onSubmit"
          >
            <UFormField label="Display label" name="label" description="A friendly name to display in the UI (defaults to project name if not set)">
              <UInput v-model="state.label" placeholder="Enter display label" />
            </UFormField>

            <UFormField label="Description" name="description" description="A description of this project">
              <UTextarea v-model="state.description" placeholder="Enter project description" :rows="3" />
            </UFormField>

            <UFormField
              label="AI diagnosis instructions"
              name="diagnosisInstructions"
              description="Project-specific context sent to the AI when diagnosing failures from this project. Combined with global instructions from Settings → AI."
            >
              <UTextarea
                v-model="state.diagnosisInstructions"
                placeholder="e.g. This project tests the payment checkout flow. The backend uses Stripe for payments and the payment API is at /api/v2/payments. Database errors are usually caused by connection pool exhaustion under load."
                :rows="5"
                class="w-full font-mono text-sm"
              />
            </UFormField>

            <UFormField label="Tags" name="tags" description="Select existing tags or type a new name and press Enter to create one.">
              <TagsSelect
                v-model="selectedTags"
                :all-tags="allTags"
                @tag-created="refreshTags()"
              />
            </UFormField>

            <div class="flex gap-2 pt-4">
              <UButton type="submit" :loading="saving">
                Save changes
              </UButton>
              <UButton variant="outline" @click="onCancel">
                Cancel
              </UButton>
            </div>
          </UForm>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
