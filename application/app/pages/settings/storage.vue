<script setup lang="ts">
import type { AdminStats } from '~~/types/api';
import { envVarsByCategory, getEnvVarMeta } from '~~/shared/piwi-env-vars';

const toast = useToast();

const { data: stats, refresh, pending } = await useFetch<AdminStats>('/api/admin/stats');

// Storage-backend env vars, driven by the shared registry (single source of
// truth). Excludes test-only vars (they are not runtime settings).
const storageEnvVars = envVarsByCategory('storage').map((name) => ({
  name,
  ...getEnvVarMeta(name),
}));

const periodOptions = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
];

const selectedPeriod = ref(30);
const isConfirmOpen = ref(false);
const cleaning = ref(false);

async function handleCleanup() {
  isConfirmOpen.value = false;
  cleaning.value = true;
  try {
    const result = await $fetch<{ success: boolean; deletedRuns: number }>('/api/admin/cleanup', {
      method: 'DELETE',
      body: { olderThanDays: selectedPeriod.value },
    });
    toast.add({
      title: 'Cleanup complete',
      description: `Deleted ${result.deletedRuns} test run(s) older than ${selectedPeriod.value} days.`,
      color: 'success',
    });
    await refresh();
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({
      title: 'Cleanup failed',
      description: errorMessage || 'An error occurred',
      color: 'error',
    });
  } finally {
    cleaning.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Storage backend (env-only reference) -->
    <SectionCard icon="i-lucide-server" title="Storage backend" help="settings.storage-backend">
      <template #subtitle> Configured through environment variables. The active backend is shown read-only. </template>

      <div class="space-y-3">
        <div class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-info" class="size-4" />
          Storage backend selection (local disk or S3) and its credentials are set via the environment. Each variable
          below is shown read-only — hover the lock to see what it controls.
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <template v-for="v in storageEnvVars" :key="v.name">
            <div class="text-muted">{{ v.name.replace('PIWI_S3_', 'S3 ').replace('PIWI_STORAGE_', 'Storage ') }}</div>
            <div class="flex items-center gap-2 font-mono">
              <code class="text-xs">{{ v.name }}</code>
              <EnvManagedBadge :env-vars="[v.name]" />
            </div>
          </template>
        </div>
      </div>
    </SectionCard>

    <!-- Stats Overview -->
    <SectionCard icon="i-lucide-database" title="Storage statistics" help="settings.storage-stats">
      <div v-if="pending" class="flex items-center gap-2 py-4 text-muted">
        <UIcon name="i-lucide-loader-2" class="animate-spin" />
        Loading…
      </div>

      <div v-else-if="stats" class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div class="space-y-1">
          <p class="text-sm text-muted">Projects</p>
          <p class="text-2xl font-semibold">
            {{ stats.totalProjects }}
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-sm text-muted">Test runs</p>
          <p class="text-2xl font-semibold">
            {{ stats.totalRuns }}
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-sm text-muted">Test cases (unique)</p>
          <p class="text-2xl font-semibold">
            {{ stats.totalTestCases }}
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-sm text-muted">Test results</p>
          <p class="text-2xl font-semibold">
            {{ stats.totalRunsCases }}
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-sm text-muted">Stored files</p>
          <p class="text-2xl font-semibold">
            {{ stats.totalFiles }}
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-sm text-muted">File size (DB)</p>
          <p class="text-2xl font-semibold">
            {{ formatBytes(stats.totalFileSize) }}
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-sm text-muted">Storage on disk</p>
          <p class="text-2xl font-semibold">
            {{ formatBytes(stats.storageSizeOnDisk) }}
          </p>
        </div>
      </div>

      <template #footer>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="outline"
          size="sm"
          :loading="pending"
          label="Refresh"
          @click="refresh()"
        />
      </template>
    </SectionCard>

    <!-- Cleanup Section -->
    <SectionCard icon="i-lucide-trash-2" title="Cleanup old test runs" help="settings.cleanup">
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <UFormField label="Delete runs older than" name="period">
          <USelect v-model="selectedPeriod" :items="periodOptions" />
        </UFormField>

        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          :loading="cleaning"
          label="Run cleanup"
          class="mt-4 sm:mt-5"
          @click="isConfirmOpen = true"
        />
      </div>
    </SectionCard>
  </div>

  <!-- Confirm Dialog -->
  <ClientOnly>
    <UModal :open="isConfirmOpen" title="Confirm cleanup" @update:open="isConfirmOpen = $event">
      <template #body>
        <p>
          This will permanently delete all test runs older than <strong>{{ selectedPeriod }} days</strong>, along with
          their associated reports, traces, and test results. This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="isConfirmOpen = false" />
        <UButton color="error" label="Delete" icon="i-lucide-trash-2" :loading="cleaning" @click="handleCleanup" />
      </template>
    </UModal>
  </ClientOnly>
</template>
