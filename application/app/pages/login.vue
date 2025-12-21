<script setup lang="ts">
const { login } = useAuth()
const router = useRouter()
const toast = useToast()

const state = reactive({
  username: '',
  password: ''
})

const loading = ref(false)
const error = ref('')

async function handleLogin() {
  if (!state.username || !state.password) {
    error.value = 'Please enter username and password'
    return
  }

  loading.value = true
  error.value = ''

  try {
    await login(state.username, state.password)
    toast.add({
      title: 'Login successful',
      color: 'success'
    })
    router.push('/')
  } catch (err: unknown) {
    const errorMessage = err && typeof err === 'object' && 'data' in err
      ? (err.data as { message?: string })?.message
      : undefined
    error.value = errorMessage || 'Invalid username or password'
    toast.add({
      title: 'Login failed',
      description: error.value,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

definePageMeta({
  layout: false
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated/50">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-lock" class="size-6" />
          <h1 class="text-2xl font-bold">
            Login
          </h1>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="handleLogin">
        <UFormField label="Username" name="username" required>
          <UInput
            v-model="state.username"
            type="text"
            placeholder="Enter your username"
            autocomplete="username"
            :disabled="loading"
          />
        </UFormField>

        <UFormField label="Password" name="password" required>
          <UInput
            v-model="state.password"
            type="password"
            placeholder="Enter your password"
            autocomplete="current-password"
            :disabled="loading"
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          :title="error"
          variant="subtle"
        />

        <UButton
          type="submit"
          block
          :loading="loading"
          :disabled="loading"
        >
          Login
        </UButton>
      </form>
    </UCard>
  </div>
</template>
