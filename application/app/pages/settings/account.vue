<script setup lang="ts">
const toast = useToast();
const route = useRoute();
const config = useRuntimeConfig();

interface MeUser {
  id: number;
  username: string;
  role: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  oauthProvider: string | null;
}

const { data: me, refresh } = await useFetch<{ authenticated: boolean; user: MeUser | null }>('/api/auth/me');

const isOAuth = computed(() => Boolean(me.value?.user?.oauthProvider));

// Email form
const emailField = ref('');
const savingEmail = ref(false);
const sendingVerify = ref(false);

// Password form
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const changingPassword = ref(false);

watch(
  () => me.value?.user,
  (u) => {
    if (u) emailField.value = u.email || '';
  },
  { immediate: true },
);

onMounted(() => {
  if (route.query.verified) {
    toast.add({ title: 'Email verified', color: 'success' });
  }
});

async function saveEmail() {
  savingEmail.value = true;
  try {
    await $fetch(`/api/users/${me.value?.user?.id}`, { method: 'PATCH', body: { email: emailField.value || null } });
    await refresh();
    toast.add({ title: 'Email updated', color: 'success' });
  } catch (e) {
    toast.add({ title: 'Failed to update email', description: String((e as Error)?.message ?? e), color: 'error' });
  } finally {
    savingEmail.value = false;
  }
}

async function sendVerification() {
  sendingVerify.value = true;
  try {
    await $fetch('/api/auth/send-verify-email', { method: 'POST' });
    toast.add({ title: 'Verification email sent', description: 'Check your inbox.', color: 'success' });
  } catch (e) {
    toast.add({
      title: 'Failed to send verification',
      description: String((e as Error)?.message ?? e),
      color: 'error',
    });
  } finally {
    sendingVerify.value = false;
  }
}

async function changePassword() {
  if (newPassword.value.length < 8) {
    toast.add({ title: 'Password too short', description: 'At least 8 characters required', color: 'error' });
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    toast.add({ title: 'Passwords do not match', color: 'error' });
    return;
  }
  changingPassword.value = true;
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    });
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    toast.add({ title: 'Password changed', color: 'success' });
  } catch (e) {
    toast.add({ title: 'Failed to change password', description: String((e as Error)?.message ?? e), color: 'error' });
  } finally {
    changingPassword.value = false;
  }
}

const authEnabled = computed(() => config.public.authEnabled);
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="!authEnabled"
      color="warning"
      icon="i-lucide-lock-open"
      title="Authentication disabled"
      description="Enable PIWI_AUTH_ENABLED=true to manage your account."
    />

    <template v-else-if="me?.user">
      <!-- Email section -->
      <SectionCard icon="i-lucide-mail" title="Email address" help="account.email">
        <div class="space-y-3">
          <div
            v-if="me.user.emailVerified"
            class="flex items-center gap-2 text-sm text-success-600 dark:text-success-400"
          >
            <UIcon name="i-lucide-circle-check-big" class="size-4" />
            Verified
          </div>
          <div v-else-if="me.user.email" class="flex items-center gap-2 text-sm text-warning-600 dark:text-warning-400">
            <UIcon name="i-lucide-circle-alert" class="size-4" />
            Not verified
            <UButton
              v-if="!isOAuth"
              size="xs"
              variant="soft"
              color="warning"
              :loading="sendingVerify"
              @click="sendVerification"
            >
              Send verification email
            </UButton>
          </div>

          <UFormField label="Email" name="email">
            <UInput
              v-model="emailField"
              type="email"
              placeholder="you@example.com"
              :disabled="isOAuth"
              class="w-full"
            />
          </UFormField>

          <p v-if="isOAuth" class="text-xs text-gray-400">
            Email is managed by <strong>{{ me.user.oauthProvider }}</strong
            >.
          </p>
        </div>

        <template v-if="!isOAuth" #footer>
          <div class="flex justify-end">
            <UButton color="primary" :loading="savingEmail" icon="i-lucide-save" @click="saveEmail">
              Save email
            </UButton>
          </div>
        </template>
      </SectionCard>

      <!-- Change password section -->
      <SectionCard v-if="!isOAuth" icon="i-lucide-lock" title="Change password">
        <div class="space-y-4">
          <UFormField label="Current password" name="currentPassword">
            <UInput
              v-model="currentPassword"
              type="password"
              placeholder="Current password"
              autocomplete="current-password"
              class="w-full"
            />
          </UFormField>
          <UFormField label="New password" name="newPassword" description="Minimum 8 characters">
            <UInput
              v-model="newPassword"
              type="password"
              placeholder="New password"
              autocomplete="new-password"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Confirm new password" name="confirmPassword">
            <UInput
              v-model="confirmPassword"
              type="password"
              placeholder="Repeat new password"
              autocomplete="new-password"
              class="w-full"
            />
          </UFormField>
        </div>

        <template #footer>
          <div class="flex justify-end">
            <UButton color="primary" :loading="changingPassword" icon="i-lucide-key-round" @click="changePassword">
              Change password
            </UButton>
          </div>
        </template>
      </SectionCard>

      <SectionCard v-else icon="i-lucide-lock" title="Password">
        <p class="text-sm text-gray-500">
          Your account is managed by <strong>{{ me.user.oauthProvider }}</strong
          >. Password management is handled by that provider.
        </p>
      </SectionCard>
    </template>
  </div>
</template>
