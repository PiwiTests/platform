<script setup lang="ts">
import { z } from 'zod'
import type { ProjectDetails, TagsResponse, TagInfo } from '~~/types/api'
import { randomHexColor } from '~/utils'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const projectId = route.params.id

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`)
const { data: tagsData, refresh: refreshTags } = await useFetch<TagsResponse>('/api/tags')

const allTags = computed(() => tagsData.value?.tags || [])

const state = ref({
  label: project.value?.label || '',
  description: project.value?.description || '',
  tagIds: (project.value?.tags || []).map((t: TagInfo) => t.id)
})

// UInputTags model — array of tag text strings currently selected
const selectedTagTexts = ref<string[]>(
  (project.value?.tags || []).map((t: TagInfo) => t.text)
)

function getTagByText(text: string): TagInfo | undefined {
  return allTags.value.find(t => t.text.toLowerCase() === String(text).toLowerCase())
}

async function onAddTag(newText: unknown) {
  const text = String(newText).trim()
  if (!text) return

  let tag = getTagByText(text)

  if (!tag) {
    // Create a new tag with a random color
    try {
      const result = await $fetch<{ tag: TagInfo }>('/api/tags', {
        method: 'POST',
        body: { text, color: randomHexColor() }
      })
      await refreshTags()
      tag = result.tag
    } catch (error: unknown) {
      // Remove the just-added text from the array since creation failed
      const idx = selectedTagTexts.value.findIndex(t => t.toLowerCase() === text.toLowerCase())
      if (idx !== -1) selectedTagTexts.value.splice(idx, 1)
      const errorMessage = error && typeof error === 'object' && 'data' in error
        ? (error.data as { message?: string })?.message
        : undefined
      toast.add({
        title: 'Failed to create tag',
        description: errorMessage || 'An error occurred',
        color: 'error'
      })
      return
    }
  }

  // Normalise the displayed text to the canonical casing from the DB
  const idx = selectedTagTexts.value.findIndex(t => t.toLowerCase() === text.toLowerCase())
  if (idx !== -1 && selectedTagTexts.value[idx] !== tag.text) {
    selectedTagTexts.value[idx] = tag.text
  }

  if (!state.value.tagIds.includes(tag.id)) {
    state.value.tagIds.push(tag.id)
  }
}

function onRemoveTag(removedText: unknown) {
  const text = String(removedText)
  const tag = getTagByText(text)
  if (tag) {
    const idx = state.value.tagIds.indexOf(tag.id)
    if (idx !== -1) state.value.tagIds.splice(idx, 1)
  }
}

const schema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  tagIds: z.array(z.number()).optional()
})

const saving = ref(false)

async function onSubmit() {
  try {
    saving.value = true

    const payload = {
      label: state.value.label || null,
      description: state.value.description || null,
      tagIds: state.value.tagIds
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

          <UForm
            :schema="schema"
            :state="state"
            class="space-y-4"
            @submit="onSubmit"
          >
            <UFormField label="Display Label" name="label" description="A friendly name to display in the UI (defaults to project name if not set)">
              <UInput v-model="state.label" placeholder="Enter display label" />
            </UFormField>

            <UFormField label="Description" name="description" description="A description of this project">
              <UTextarea v-model="state.description" placeholder="Enter project description" :rows="3" />
            </UFormField>

            <UFormField label="Tags" name="tagIds" description="Type a tag name and press Enter to assign it. If the tag doesn't exist yet it will be created automatically.">
              <UInputTags
                v-model="selectedTagTexts"
                placeholder="Type a tag name and press Enter…"
                icon="i-lucide-tag"
                class="w-full"
                @add-tag="onAddTag"
                @remove-tag="onRemoveTag"
              >
                <template #item-text="{ item }">
                  <span class="flex items-center gap-1.5">
                    <span
                      v-if="getTagByText(String(item))"
                      class="inline-block size-2 rounded-full shrink-0"
                      :style="{ backgroundColor: getTagByText(String(item))?.color }"
                    />
                    {{ item }}
                  </span>
                </template>
              </UInputTags>
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
