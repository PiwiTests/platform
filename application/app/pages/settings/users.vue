<script setup lang="ts">
import { z } from 'zod'

interface User {
  id: number
  username: string
  role: string
  name?: string | null
  createdAt: Date
  updatedAt: Date
}

interface UsersResponse {
  users: User[]
  authEnabled: boolean
}

const { data: usersData, refresh } = await useFetch<UsersResponse>('/api/users')
const toast = useToast()
const { authState } = useAuth()
const config = useRuntimeConfig()

const users = computed(() => usersData.value?.users || [])
const authEnabled = computed(() => usersData.value?.authEnabled || false)

// Check if current user is admin (only matters when auth is enabled)
const isAdmin = computed(() => {
  if (!config.public.authEnabled) return true
  return authState.value.user?.role === 'administrator'
})

// Add user modal
const isAddUserModalOpen = ref(false)
const addUserSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['administrator', 'reporter', 'user']),
  name: z.string().optional()
})

type AddUserSchema = z.output<typeof addUserSchema>

const newUser = reactive<Partial<AddUserSchema>>({
  username: '',
  password: '',
  role: 'user',
  name: ''
})

const roleOptions = [
  { label: 'Administrator', value: 'administrator' },
  { label: 'Reporter', value: 'reporter' },
  { label: 'User', value: 'user' }
]

async function handleAddUser() {
  try {
    await $fetch('/api/users', {
      method: 'POST',
      body: newUser
    })

    toast.add({
      title: 'User created',
      description: `User ${newUser.username} has been created successfully`,
      color: 'success'
    })

    isAddUserModalOpen.value = false
    newUser.username = ''
    newUser.password = ''
    newUser.role = 'user'
    newUser.name = ''

    await refresh()
  } catch (error: unknown) {
    const errorMessage = error && typeof error === 'object' && 'data' in error
      ? (error.data as { message?: string })?.message
      : undefined
    toast.add({
      title: 'Failed to create user',
      description: errorMessage || 'An error occurred',
      color: 'error'
    })
  }
}

async function handleDeleteUser(user: User) {
  if (!confirm(`Are you sure you want to delete user "${user.username}"?`)) {
    return
  }

  try {
    await $fetch(`/api/users/${user.id}`, {
      method: 'DELETE'
    })

    toast.add({
      title: 'User deleted',
      description: `User ${user.username} has been deleted`,
      color: 'success'
    })

    await refresh()
  } catch (error: unknown) {
    const errorMessage = error && typeof error === 'object' && 'data' in error
      ? (error.data as { message?: string })?.message
      : undefined
    toast.add({
      title: 'Failed to delete user',
      description: errorMessage || 'An error occurred',
      color: 'error'
    })
  }
}

function getRoleBadgeColor(role: string) {
  switch (role) {
    case 'administrator':
      return 'primary'
    case 'reporter':
      return 'info'
    case 'user':
      return 'neutral'
    default:
      return 'neutral'
  }
}
</script>

<template>
  <UDashboardPanel grow>
    <template #header>
      <UDashboardNavbar title="User Management">
        <template #right>
          <UButton
            v-if="isAdmin"
            label="Add User"
            icon="i-lucide-user-plus"
            @click="isAddUserModalOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Info message when auth is disabled -->
      <UAlert
        v-if="!authEnabled"
        icon="i-lucide-info"
        color="primary"
        variant="subtle"
        title="Authentication is disabled"
        description="Authentication is currently disabled. You can manage users here, but they will only be used when authentication is enabled via the NUXT_AUTH_ENABLED environment variable."
        class="mb-4"
      />

      <!-- Users table -->
      <UCard v-if="users.length > 0">
        <template #header>
          <h3 class="text-lg font-semibold">
            Users ({{ users.length }})
          </h3>
        </template>

        <UTable
          :rows="users"
          :columns="[
            { key: 'username', label: 'Username' },
            { key: 'name', label: 'Name' },
            { key: 'role', label: 'Role' },
            { key: 'createdAt', label: 'Created' },
            { key: 'actions', label: '' }
          ]"
        >
          <template #name-data="{ row }">
            <span class="text-muted">{{ row.name || '-' }}</span>
          </template>

          <template #role-data="{ row }">
            <UBadge :color="getRoleBadgeColor(row.role)" variant="subtle">
              {{ row.role }}
            </UBadge>
          </template>

          <template #createdAt-data="{ row }">
            <span class="text-sm text-muted">
              {{ new Date(row.createdAt).toLocaleDateString() }}
            </span>
          </template>

          <template #actions-data="{ row }">
            <UButton
              v-if="isAdmin"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="sm"
              @click="handleDeleteUser(row)"
            />
          </template>
        </UTable>
      </UCard>

      <!-- Empty state -->
      <UCard v-else>
        <div class="text-center py-12">
          <div class="flex justify-center mb-4">
            <UIcon name="i-lucide-users" class="text-4xl text-muted" />
          </div>
          <h3 class="text-lg font-semibold mb-2">
            No users yet
          </h3>
          <p class="text-muted mb-4">
            Create your first user to get started with authentication
          </p>
          <UButton
            v-if="isAdmin"
            label="Add User"
            icon="i-lucide-user-plus"
            @click="isAddUserModalOpen = true"
          />
        </div>
      </UCard>
    </template>
  </UDashboardPanel>

  <!-- Add User Modal -->
  <UModal v-model="isAddUserModalOpen">
    <UCard>
      <template #header>
        <h3 class="text-lg font-semibold">
          Add New User
        </h3>
      </template>

      <UForm :schema="addUserSchema" :state="newUser" @submit="handleAddUser">
        <UFormField
          label="Username"
          name="username"
          required
          class="mb-4"
        >
          <UInput v-model="newUser.username" placeholder="Enter username" />
        </UFormField>

        <UFormField
          label="Password"
          name="password"
          required
          class="mb-4"
        >
          <UInput v-model="newUser.password" type="password" placeholder="Enter password" />
        </UFormField>

        <UFormField label="Display Name" name="name" class="mb-4">
          <UInput v-model="newUser.name" placeholder="Enter display name (optional)" />
        </UFormField>

        <UFormField
          label="Role"
          name="role"
          required
          class="mb-4"
        >
          <USelect v-model="newUser.role" :options="roleOptions" />
        </UFormField>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="isAddUserModalOpen = false"
          />
          <UButton
            type="submit"
            label="Create User"
            icon="i-lucide-user-plus"
          />
        </div>
      </UForm>
    </UCard>
  </UModal>
</template>
