<script setup lang="ts">
const runtimeConfig = useRuntimeConfig();
const isDemoMode = runtimeConfig.public.demoMode;
const isResetting = ref(false);
const toast = useToast();

async function resetDemo() {
  isResetting.value = true;
  try {
    const { resetDemoDb } = await import('~/demo/db.client');
    await resetDemoDb();
    toast.add({
      title: 'Demo reset',
      description: 'The demo database has been reset to its initial state.',
      icon: 'i-lucide-refresh-cw',
      color: 'success',
    });
    // Brief delay so the success toast is visible before the reload clears the page
    setTimeout(() => window.location.reload(), 800);
  } catch (e) {
    toast.add({
      title: 'Reset failed',
      description: String(e),
      icon: 'i-lucide-x-circle',
      color: 'error',
    });
    isResetting.value = false;
  }
}
</script>

<template>
  <UPageCard v-if="isDemoMode" variant="subtle">
    <div class="flex max-sm:flex-col justify-between items-start gap-4">
      <div>
        <p class="font-medium text-sm">Reset demo data</p>
        <p class="text-sm text-muted">
          Wipe the in-browser database and reload with the original seed data. All changes made during this demo session
          will be lost.
        </p>
      </div>
      <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" :loading="isResetting" @click="resetDemo">
        Reset demo
      </UButton>
    </div>
  </UPageCard>

  <UPageCard v-else variant="subtle">
    <div class="text-sm text-muted">
      <p class="font-medium text-default">General settings</p>
      <p class="mt-1">
        Appearance and theme are in the top bar. Use the sidebar to manage your account, users, AI diagnosis,
        notifications, storage, and tags.
      </p>
    </div>
  </UPageCard>
</template>
