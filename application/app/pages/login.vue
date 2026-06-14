<script setup lang="ts">
const { login } = useAuth();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const config = useRuntimeConfig();

const state = reactive({
  username: '',
  password: '',
});

const loading = ref(false);
const error = ref('');

const oauthProviders = computed(() => {
  if (config.public.demoMode) return [];
  return (config.public.oauthProviders as string[]) || [];
});

// Check for OAuth error from callback redirect
onMounted(() => {
  const oauthError = route.query.error as string | undefined;
  if (oauthError) {
    const messages: Record<string, string> = {
      'access-denied': 'Access was denied',
      'invalid-state': 'Authentication failed (invalid state)',
      'missing-code': 'Authentication failed (missing code)',
      'oauth-failed': 'OAuth authentication failed',
      'auth-disabled': 'Authentication is not enabled',
      'invalid-provider': 'Invalid OAuth provider',
    };
    error.value = messages[oauthError] || 'Authentication failed';
  }
});

async function handleLogin() {
  if (!state.username || !state.password) {
    error.value = 'Please enter username and password';
    return;
  }

  loading.value = true;
  error.value = '';

  try {
    await login(state.username, state.password);
    toast.add({
      title: 'Login successful',
      color: 'success',
    });
    router.push('/');
  } catch (err: unknown) {
    const errorMessage =
      err && typeof err === 'object' && 'data' in err ? (err.data as { message?: string })?.message : undefined;
    error.value = errorMessage || 'Invalid username or password';
    toast.add({
      title: 'Login failed',
      description: error.value,
      color: 'error',
    });
  } finally {
    loading.value = false;
  }
}

function startOAuth(provider: string) {
  window.location.href = `/api/auth/oauth/${provider}/login`;
}

definePageMeta({
  layout: false,
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated/50">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-lock" class="size-6" />
          <h1 class="text-2xl font-bold">Login</h1>
        </div>
      </template>

      <UAlert v-if="error" color="error" :title="error" variant="subtle" class="mb-4" />

      <!-- OAuth buttons -->
      <div v-if="oauthProviders.length > 0" class="space-y-2 mb-4">
        <UButton
          v-if="oauthProviders.includes('google')"
          block
          color="neutral"
          variant="outline"
          @click="startOAuth('google')"
        >
          <template #leading>
            <UIcon name="i-lucide-chrome" class="size-5" />
          </template>
          Sign in with Google
        </UButton>

        <UButton
          v-if="oauthProviders.includes('github')"
          block
          color="neutral"
          variant="outline"
          @click="startOAuth('github')"
        >
          <template #leading>
            <UIcon name="i-lucide-github" class="size-5" />
          </template>
          Sign in with GitHub
        </UButton>

        <UDivider v-if="oauthProviders.length > 0" class="my-4"> or continue with password </UDivider>
      </div>

      <!-- Password login form -->
      <form class="space-y-4" @submit.prevent="handleLogin">
        <UFormField label="Username" name="username" required>
          <UInput
            v-model="state.username"
            type="text"
            placeholder="Enter your username"
            autocomplete="username"
            :disabled="loading"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Password" name="password" required>
          <UInput
            v-model="state.password"
            type="password"
            placeholder="Enter your password"
            autocomplete="current-password"
            :disabled="loading"
            class="w-full"
          />
        </UFormField>

        <UButton type="submit" block :loading="loading" :disabled="loading"> Login </UButton>
      </form>
    </UCard>
  </div>
</template>
