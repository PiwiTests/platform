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
      'account-exists': 'This email is already linked to a different sign-in method. Sign in with that method instead.',
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
  <div class="min-h-screen flex flex-col items-center justify-center bg-elevated/50 gap-6 px-4">
    <img src="/logo-wide.svg" alt="Piwi Dashboard" class="h-16 rounded-xl" />

    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-xl font-semibold">Sign in to your account</h1>
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

        <USeparator v-if="oauthProviders.length > 0" label="or continue with password" class="my-4" />
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

      <div class="mt-4 text-center">
        <NuxtLink to="/forgot-password" class="text-sm text-muted hover:text-default"> Forgot password? </NuxtLink>
      </div>
    </UCard>

    <div class="flex items-center gap-4 text-sm text-muted">
      <a
        href="https://github.com/piwitests/platform"
        target="_blank"
        rel="noopener"
        class="flex items-center gap-1.5 hover:text-default transition-colors"
      >
        <UIcon name="i-lucide-github" class="size-4" />
        GitHub
      </a>
      <span>·</span>
      <a href="/docs" class="flex items-center gap-1.5 hover:text-default transition-colors">
        <UIcon name="i-lucide-book-open" class="size-4" />
        API Docs
      </a>
    </div>
  </div>
</template>
