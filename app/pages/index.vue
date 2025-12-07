<template>
  <div class="min-h-screen bg-gray-50">
    <div class="container mx-auto p-6">
      <div class="mb-8">
        <h1 class="text-4xl font-bold text-gray-900">Playwright Dashboard</h1>
        <p class="text-gray-600 mt-2">Manage and view your Playwright test results</p>
      </div>

      <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-semibold">Projects</h2>
        <UButton @click="showCreateModal = true" icon="i-heroicons-plus">
          New Project
        </UButton>
      </div>

      <div v-if="pending" class="text-center py-12">
        <p class="text-gray-500">Loading projects...</p>
      </div>

      <div v-else-if="projects?.length === 0" class="text-center py-12 bg-white rounded-lg border">
        <p class="text-gray-500 mb-4">No projects yet</p>
        <UButton @click="showCreateModal = true">Create Your First Project</UButton>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <UCard 
          v-for="project in projects" 
          :key="project.id"
          class="cursor-pointer hover:shadow-lg transition-shadow"
          @click="navigateTo(`/projects/${project.id}`)"
        >
          <template #header>
            <h3 class="text-xl font-semibold">{{ project.name }}</h3>
          </template>
          
          <p v-if="project.description" class="text-gray-600 text-sm">
            {{ project.description }}
          </p>
          <p v-else class="text-gray-400 text-sm italic">No description</p>
          
          <template #footer>
            <div class="text-xs text-gray-500">
              Updated {{ formatDate(project.updatedAt) }}
            </div>
          </template>
        </UCard>
      </div>

      <!-- Create Project Modal -->
      <UModal v-model="showCreateModal">
        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">Create New Project</h3>
          </template>
          
          <div class="space-y-4">
            <UFormGroup label="Project Name" required>
              <UInput v-model="newProject.name" placeholder="My Playwright Project" />
            </UFormGroup>
            
            <UFormGroup label="Description">
              <UTextarea v-model="newProject.description" placeholder="Project description..." />
            </UFormGroup>
          </div>
          
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="gray" variant="ghost" @click="showCreateModal = false">
                Cancel
              </UButton>
              <UButton @click="createProject" :loading="creating">
                Create Project
              </UButton>
            </div>
          </template>
        </UCard>
      </UModal>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Project } from '~/types'

const showCreateModal = ref(false)
const creating = ref(false)
const newProject = ref({
  name: '',
  description: ''
})

const { data: projects, pending, refresh } = await useFetch<Project[]>('/api/projects')

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const createProject = async () => {
  if (!newProject.value.name) return
  
  creating.value = true
  try {
    await $fetch('/api/projects', {
      method: 'POST',
      body: newProject.value
    })
    
    showCreateModal.value = false
    newProject.value = { name: '', description: '' }
    await refresh()
  } finally {
    creating.value = false
  }
}
</script>
