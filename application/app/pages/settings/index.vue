<script setup lang="ts">
import * as z from 'zod';
import type { FormSubmitEvent } from '@nuxt/ui';

const settingsSchema = z.object({
  foo: z.string().min(2, 'Too short'),
});

type SettingsSchema = z.output<typeof settingsSchema>;

const profile = reactive<Partial<SettingsSchema>>({
  foo: 'Bar',
});
const toast = useToast();
async function onSubmit(event: FormSubmitEvent<SettingsSchema>) {
  toast.add({
    title: 'Success',
    description: 'Your settings have been updated.',
    icon: 'i-lucide-check',
    color: 'success',
  });

  // Save settings
  console.log('Submitted settings:', event.data);
}

const runtimeConfig = useRuntimeConfig();
const isDemoMode = runtimeConfig.public.demoMode;
const isResetting = ref(false);

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
  <UForm id="settings" :schema="settingsSchema" :state="profile" @submit="onSubmit">
    <UPageCard variant="subtle">
      <UFormField
        name="foo"
        label="Foo"
        description="Foo description."
        required
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput v-model="profile.foo" autocomplete="off" />
      </UFormField>
      <USeparator />
    </UPageCard>
  </UForm>
  <UPageCard v-if="isDemoMode" variant="subtle" class="mt-4">
    <div class="flex max-sm:flex-col justify-between items-start gap-4">
      <div>
        <p class="font-medium text-sm">Reset Demo Data</p>
        <p class="text-sm text-muted">
          Wipe the in-browser database and reload with the original seed data. All changes made during this demo session
          will be lost.
        </p>
      </div>
      <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" :loading="isResetting" @click="resetDemo">
        Reset Demo
      </UButton>
    </div>
  </UPageCard>
</template>
