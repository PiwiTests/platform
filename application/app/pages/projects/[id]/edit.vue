<script setup lang="ts">
import { z } from 'zod'

interface Project {
  id: number
  name: string
  label?: string
  description?: string
  color?: string
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const projectId = route.params.id

const { data: project, refresh } = await useFetch<Project>(`/api/projects/${projectId}`)

const state = ref({
  label: project.value?.label || '',
  description: project.value?.description || '',
  color: project.value?.color || ''
})

const colorOptions = [
  { value: '', label: 'None' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#84cc16', label: 'Lime' },
  { value: '#22c55e', label: 'Green' },
  { value: '#10b981', label: 'Emerald' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#0ea5e9', label: 'Sky' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#d946ef', label: 'Fuchsia' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#f43f5e', label: 'Rose' }
]

const schema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  color: z.string().regex(/^(|#[0-9A-Fa-f]{6})$/, 'Invalid color format').optional()
})

const saving = ref(false)

async function onSubmit() {
  try {
    saving.value = true

    const payload = {
      label: state.value.label || null,
      description: state.value.description || null,
      color: state.value.color || null
    }

    await $fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      body: payload
    })

    toast.add({
      title: 'Project updated',
      description: 'Project settings have been saved successfully',
      color: 'success'
    })

    // Navigate back to project page
    router.push(`/projects/${projectId}`)
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
      <UDashboardNavbar :title="`Edit ${project?.name || 'Project'}`">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <UButton
          :to="`/projects/${projectId}`"
          icon="i-lucide-arrow-left"
          variant="ghost"
          size="sm"
        >
          Back to Project
        </UButton>

        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Edit Project Settings
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Project Name: <span class="font-medium">{{ project?.name }}</span>
            </p>
            <p class="text-xs text-gray-500 mt-1">
              Note: The project name is used to match test results from the reporter and cannot be changed.
            </p>
          </template>

          <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
            <UFormField label="Display Label" name="label" description="A friendly name to display in the UI (defaults to project name if not set)">
              <UInput v-model="state.label" placeholder="Enter display label" />
            </UFormField>

            <UFormField label="Description" name="description" description="A description of this project">
              <UTextarea v-model="state.description" placeholder="Enter project description" :rows="3" />
            </UFormField>

            <UFormField label="Color" name="color" description="A color to help identify this project in the UI">
              <USelectMenu
                v-model="state.color"
                :options="colorOptions"
                value-attribute="value"
                option-attribute="label"
              />
              <div v-if="state.color" class="flex items-center gap-2 mt-2 text-sm">
                <div
                  class="w-4 h-4 rounded"
                  :style="{ backgroundColor: state.color }"
                />
                <span>Selected: {{ colorOptions.find(c => c.value === state.color)?.label }}</span>
              </div>
            </UFormField>

            <div class="flex gap-2 pt-4">
              <UButton type="submit" :loading="saving">
                Save Changes
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
