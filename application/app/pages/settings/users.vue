<script setup lang="ts">
import { z } from 'zod'
import type { TableColumn } from '@nuxt/ui'
import type { UserDetails, UsersResponse, ApiKeySummary, ApiKeysResponse, CreateApiKeyResponse } from '~~/types/api'

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

// Current user id (for showing own API keys)
const currentUserId = computed(() => authState.value.user?.id ?? null)

// Define columns with proper typing
const columns: TableColumn<UserDetails>[] = [
  { accessorKey: 'username', header: createSortHeader<UserDetails>('Username') },
  { accessorKey: 'name', header: createSortHeader<UserDetails>('Name') },
  { accessorKey: 'role', header: createSortHeader<UserDetails>('Role') },
  { accessorKey: 'createdAt', header: createSortHeader<UserDetails>('Created') },
  { accessorKey: 'actions', header: '' }
]

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

async function handleDeleteUser(user: UserDetails) {
  userToDelete.value = user
  isDeleteUserConfirmOpen.value = true
}

async function confirmDeleteUser() {
  const user = userToDelete.value
  if (!user) return
  isDeleteUserConfirmOpen.value = false
  userToDelete.value = null

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

// Delete user confirmation
const isDeleteUserConfirmOpen = ref(false)
const userToDelete = ref<UserDetails | null>(null)

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

// ---------------------------------------------------------------------------
// API key management
// ---------------------------------------------------------------------------

// Which user's API keys are being viewed/managed
const selectedUserForKeys = ref<UserDetails | null>(null)
const isApiKeysModalOpen = ref(false)

const apiKeysList = ref<ApiKeySummary[]>([])

async function openApiKeysModal(user: UserDetails) {
  selectedUserForKeys.value = user
  isApiKeysModalOpen.value = true
  await loadApiKeys(user.id)
}

async function loadApiKeys(userId: number) {
  try {
    const data = await $fetch<ApiKeysResponse>(`/api/users/${userId}/api-keys`)
    apiKeysList.value = data.apiKeys
  } catch {
    apiKeysList.value = []
  }
}

async function refreshApiKeys() {
  if (selectedUserForKeys.value) {
    await loadApiKeys(selectedUserForKeys.value.id)
  }
}

// Create API key (inline in the API keys modal)
const isCreatingKey = ref(false)
const newKeyName = ref('')
const newKeyExpiry = ref('')
const createdKeyValue = ref<string | null>(null)

function startCreateKey() {
  newKeyName.value = ''
  newKeyExpiry.value = ''
  createdKeyValue.value = null
  isCreatingKey.value = true
}

function cancelCreateKey() {
  isCreatingKey.value = false
  createdKeyValue.value = null
}

async function handleCreateApiKey() {
  if (!selectedUserForKeys.value) return

  try {
    const body: { name: string, expiresAt?: string } = { name: newKeyName.value }
    if (newKeyExpiry.value) {
      body.expiresAt = new Date(newKeyExpiry.value).toISOString()
    }

    const result = await $fetch<CreateApiKeyResponse>(`/api/users/${selectedUserForKeys.value.id}/api-keys`, {
      method: 'POST',
      body
    })

    createdKeyValue.value = result.key
    await refreshApiKeys()
  } catch (error: unknown) {
    const errorMessage = error && typeof error === 'object' && 'data' in error
      ? (error.data as { message?: string })?.message
      : undefined
    toast.add({
      title: 'Failed to create API key',
      description: errorMessage || 'An error occurred',
      color: 'error'
    })
  }
}

async function copyKey() {
  if (createdKeyValue.value) {
    await navigator.clipboard.writeText(createdKeyValue.value)
    toast.add({ title: 'API key copied to clipboard', color: 'success' })
  }
}

function dismissCreatedKey() {
  createdKeyValue.value = null
  isCreatingKey.value = false
}

// Revoke API key confirmation
const isRevokeKeyConfirmOpen = ref(false)
const keyToRevoke = ref<ApiKeySummary | null>(null)

function confirmRevokeApiKey(key: ApiKeySummary) {
  keyToRevoke.value = key
  isRevokeKeyConfirmOpen.value = true
}

async function handleRevokeApiKey() {
  if (!selectedUserForKeys.value || !keyToRevoke.value) return
  const key = keyToRevoke.value
  isRevokeKeyConfirmOpen.value = false
  keyToRevoke.value = null

  try {
    await $fetch(`/api/users/${selectedUserForKeys.value.id}/api-keys/${key.id}`, {
      method: 'DELETE'
    })

    toast.add({
      title: 'API key revoked',
      description: `Key "${key.name}" has been revoked`,
      color: 'success'
    })

    await refreshApiKeys()
  } catch (error: unknown) {
    const errorMessage = error && typeof error === 'object' && 'data' in error
      ? (error.data as { message?: string })?.message
      : undefined
    toast.add({
      title: 'Failed to revoke API key',
      description: errorMessage || 'An error occurred',
      color: 'error'
    })
  }
}

function canManageApiKeys(user: UserDetails): boolean {
  if (!config.public.authEnabled) return true
  return isAdmin.value || currentUserId.value === user.id
}
</script>

<template>
  <UDashboardPanel grow>
    <template #header>
      <UDashboardNavbar title="User management">
        <template #right>
          <UButton
            v-if="isAdmin"
            label="Add user"
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
          Users ({{ users.length }})
        </template>

        <UTable
          :data="users"
          :columns="columns"
        >
          <template #username-cell="{ row }">
            {{ row.original.username }}
          </template>

          <template #name-cell="{ row }">
            <span class="text-muted">{{ row.original.name || '-' }}</span>
          </template>

          <template #role-cell="{ row }">
            <UBadge :color="getRoleBadgeColor(row.original.role)" variant="subtle">
              {{ row.original.role }}
            </UBadge>
          </template>

          <template #createdAt-cell="{ row }">
            <span class="text-sm text-muted">
              {{ new Date(row.original.createdAt).toLocaleDateString() }}
            </span>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center gap-1">
              <UButton
                v-if="canManageApiKeys(row.original)"
                icon="i-lucide-key"
                color="neutral"
                variant="ghost"
                size="sm"
                title="Manage API keys"
                @click="openApiKeysModal(row.original)"
              />
              <UButton
                v-if="isAdmin"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                @click="handleDeleteUser(row.original)"
              />
            </div>
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
            label="Add user"
            icon="i-lucide-user-plus"
            @click="isAddUserModalOpen = true"
          />
        </div>
      </UCard>
    </template>
  </UDashboardPanel>

  <!-- Add User Modal -->
  <ClientOnly>
    <UModal :open="isAddUserModalOpen" title="Add new user" @update:open="isAddUserModalOpen = $event">
      <template #body>
        <UForm :schema="addUserSchema" :state="newUser">
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

          <UFormField label="Display name" name="name" class="mb-4">
            <UInput v-model="newUser.name" placeholder="Enter display name (optional)" />
          </UFormField>

          <UFormField
            label="Role"
            name="role"
            required
          >
            <USelect v-model="newUser.role" :items="roleOptions" />
          </UFormField>
        </UForm>
      </template>

      <template #footer>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="isAddUserModalOpen = false"
        />
        <UButton
          type="submit"
          label="Create user"
          icon="i-lucide-user-plus"
          @click="handleAddUser"
        />
      </template>
    </UModal>
  </ClientOnly>

  <!-- API Keys Modal (single panel with inline create form) -->
  <ClientOnly>
    <UModal
      :open="isApiKeysModalOpen"
      :title="`API keys – ${selectedUserForKeys?.username}`"
      size="xl"
      @update:open="v => { isApiKeysModalOpen = v; if (!v) cancelCreateKey() }"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            API keys allow the Playwright reporter (and other CI tools) to submit test results without a username/password login.
            Each key is shown <strong>only once</strong> at creation time — store it in a CI secret immediately.
          </p>

          <!-- Inline Create Key Form -->
          <div v-if="isCreatingKey" class="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
            <!-- Show new key after creation -->
            <div v-if="createdKeyValue" class="space-y-4">
              <UAlert
                icon="i-lucide-triangle-alert"
                color="warning"
                variant="subtle"
                title="Save your API key now"
                description="This key will never be shown again. Copy it and store it in your CI secret manager immediately."
              />
              <div class="rounded-lg bg-elevated p-3 font-mono text-sm break-all select-all">
                {{ createdKeyValue }}
              </div>
              <div class="flex gap-2">
                <UButton
                  label="Copy to clipboard"
                  icon="i-lucide-copy"
                  color="primary"
                  size="sm"
                  @click="copyKey"
                />
                <UButton
                  label="Done"
                  variant="ghost"
                  size="sm"
                  @click="dismissCreatedKey"
                />
              </div>
            </div>

            <!-- Key creation form -->
            <div v-else class="space-y-3">
              <h4 class="font-medium text-sm">
                Create new API key
              </h4>
              <UFormField label="Key name" name="name" required>
                <UInput
                  v-model="newKeyName"
                  placeholder="e.g. GitHub Actions CI"
                  size="sm"
                />
              </UFormField>

              <UFormField label="Expires at (optional)" name="expiresAt">
                <UInput
                  v-model="newKeyExpiry"
                  type="date"
                  size="sm"
                  :min="new Date().toISOString().split('T')[0]"
                />
              </UFormField>

              <div class="flex gap-2">
                <UButton
                  label="Generate key"
                  icon="i-lucide-key"
                  size="sm"
                  :disabled="!newKeyName.trim()"
                  @click="handleCreateApiKey"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  label="Cancel"
                  size="sm"
                  @click="cancelCreateKey"
                />
              </div>
            </div>
          </div>

          <!-- Key list -->
          <div v-if="apiKeysList.length > 0" class="space-y-2">
            <div
              v-for="key in apiKeysList"
              :key="key.id"
              class="flex items-center justify-between rounded-lg border border-default px-4 py-3"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-key" class="text-muted shrink-0" />
                  <span class="font-medium truncate">{{ key.name }}</span>
                </div>
                <div class="text-xs text-muted mt-1 flex flex-wrap gap-x-4">
                  <span>Prefix: <code class="font-mono">pd_{{ key.keyPrefix }}…</code></span>
                  <span>Created: {{ new Date(key.createdAt).toLocaleDateString() }}</span>
                  <span v-if="key.lastUsedAt">Last used: {{ new Date(key.lastUsedAt).toLocaleDateString() }}</span>
                  <span v-else class="italic">Never used</span>
                  <span v-if="key.expiresAt" :class="new Date(key.expiresAt) < new Date() ? 'text-error' : ''">
                    Expires: {{ new Date(key.expiresAt).toLocaleDateString() }}
                  </span>
                </div>
              </div>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                title="Revoke key"
                @click="confirmRevokeApiKey(key)"
              />
            </div>
          </div>

          <div v-else-if="!isCreatingKey" class="text-center text-muted py-6 text-sm">
            No API keys yet. Create one to allow CI access.
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          label="Close"
          @click="isApiKeysModalOpen = false"
        />
        <UButton
          v-if="!isCreatingKey"
          label="Create API key"
          icon="i-lucide-plus"
          @click="startCreateKey"
        />
      </template>
    </UModal>
  </ClientOnly>

  <!-- Delete User Confirmation Modal -->
  <ClientOnly>
    <UModal :open="isDeleteUserConfirmOpen" title="Delete user" @update:open="isDeleteUserConfirmOpen = $event">
      <template #body>
        <p>Are you sure you want to delete user <strong>{{ userToDelete?.username }}</strong>? This action cannot be undone.</p>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="isDeleteUserConfirmOpen = false"
        />
        <UButton
          color="error"
          label="Delete user"
          icon="i-lucide-trash-2"
          @click="confirmDeleteUser"
        />
      </template>
    </UModal>
  </ClientOnly>

  <!-- Revoke API Key Confirmation Modal -->
  <ClientOnly>
    <UModal :open="isRevokeKeyConfirmOpen" title="Revoke API key" @update:open="isRevokeKeyConfirmOpen = $event">
      <template #body>
        <p>Revoke API key <strong>"{{ keyToRevoke?.name }}"</strong>? Any CI pipeline using it will stop working immediately.</p>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="isRevokeKeyConfirmOpen = false"
        />
        <UButton
          color="error"
          label="Revoke"
          icon="i-lucide-trash-2"
          @click="handleRevokeApiKey"
        />
      </template>
    </UModal>
  </ClientOnly>
</template>
