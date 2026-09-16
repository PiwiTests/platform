<script setup lang="ts">
/**
 * Setup — the permanent home for "how do I connect this, and what else can it do?".
 *
 * The connect steps used to live only on Home behind `v-if="!hasProjects"`, so
 * everything past step one became undiscoverable the moment the first run
 * landed. This page keeps the wizard reachable forever and pairs it with a
 * capability ladder that reports which optional features are actually live on
 * this instance — the answer to "is this empty because it's broken, or because
 * I never switched it on?".
 */
import type { SetupStatus } from '#shared/handlers/setup-status';
import type { AdminStats } from '~~/types/api';
import { SETUP_CAPABILITIES } from '~/utils/setup-capabilities';

useHead({ title: 'Setup — Piwi Dashboard' });

const isDesktop = useIsDesktop();

// Desktop build only: where the data lives and how to point the reporter and MCP
// clients at this local instance. These lived on Settings → About, which is not
// where anyone looks for "how do I connect to this" — About is for versions.
const { data: stats } = await useFetch<AdminStats | null>('/api/admin/stats', {
  immediate: isDesktop,
  default: () => null,
});
const { data: reporterConfig } = await useFetch<{ url: string; token: string } | null>('/api/desktop/reporter-config', {
  immediate: isDesktop,
  default: () => null,
});

const { data: status, status: fetchStatus } = await useFetch<SetupStatus>('/api/setup-status', {
  lazy: true,
  default: () => ({ capabilities: [] }) as SetupStatus,
});

const activeById = computed(() => {
  const map = new Map<string, boolean>();
  for (const c of status.value?.capabilities ?? []) map.set(c.id, c.active);
  return map;
});

const isLoading = computed(() => fetchStatus.value === 'pending' && !status.value?.capabilities.length);

const rows = computed(() =>
  SETUP_CAPABILITIES.map((copy) => ({ ...copy, active: activeById.value.get(copy.id) ?? false })),
);

const activeCount = computed(() => rows.value.filter((r) => r.active).length);
</script>

<template>
  <UDashboardPanel id="setup">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Setup', icon: 'i-lucide-rocket', to: '/setup' }]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6 w-full lg:max-w-4xl mx-auto">
        <!-- Desktop build: connecting to this local instance comes before the
             generic reporter steps, since the token/URL are specific to it. -->
        <template v-if="isDesktop">
          <DesktopReporterCard v-if="reporterConfig" :url="reporterConfig.url" :token="reporterConfig.token" />
          <SectionCard icon="i-lucide-plug" title="Connect an AI assistant (MCP)">
            <template #subtitle>
              This app exposes a local MCP endpoint so agents like Claude can query your test results. The MCP server
              page has the URL and access token for this instance already baked into one-click setup for every client.
            </template>
            <UButton to="/mcp" color="neutral" variant="soft" trailing-icon="i-lucide-arrow-right">
              Open MCP setup
            </UButton>
          </SectionCard>
          <DataLocationCard v-if="stats" :database="stats.databaseLocation" :storage="stats.storageLocation" />
          <DesktopServiceCard />
        </template>

        <GetStartedWizard />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="p-2 bg-primary/10 rounded-lg shrink-0">
                  <UIcon name="i-lucide-list-checks" class="size-5 text-primary" />
                </div>
                <div>
                  <h2 class="text-xl font-semibold">What's switched on</h2>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    Detected from your data, not your config — a capability reads as active once this instance has
                    actually used it.
                  </p>
                </div>
              </div>
              <UBadge v-if="!isLoading" color="neutral" variant="subtle" class="shrink-0 max-sm:hidden">
                {{ activeCount }} / {{ rows.length }}
              </UBadge>
            </div>
          </template>

          <LoadingState v-if="isLoading" />

          <ul v-else class="divide-y divide-default">
            <li v-for="row in rows" :key="row.id" class="flex gap-4 py-4 first:pt-0 last:pb-0">
              <div
                class="flex size-9 shrink-0 items-center justify-center rounded-lg"
                :class="row.active ? 'bg-success/10 text-success' : 'bg-elevated text-dimmed'"
              >
                <UIcon :name="row.icon" class="size-5" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <h3 class="font-medium">{{ row.title }}</h3>
                  <UBadge v-if="row.active" color="success" variant="subtle" size="xs">Active</UBadge>
                  <UBadge v-else-if="row.optional" color="neutral" variant="subtle" size="xs">Optional</UBadge>
                  <UBadge v-else color="warning" variant="subtle" size="xs">Not set up</UBadge>
                </div>

                <p class="text-sm text-gray-600 dark:text-gray-400">{{ row.summary }}</p>

                <p v-if="!row.active" class="text-sm text-dimmed mt-1">{{ row.how }}</p>

                <div class="flex items-center gap-3 mt-2 text-sm">
                  <UButton v-if="row.to && !row.active" :to="row.to" size="xs" variant="soft" icon="i-lucide-settings">
                    {{ row.toLabel ?? 'Configure' }}
                  </UButton>
                  <DocLink v-if="row.doc" :to="row.doc" class="text-sm">Docs</DocLink>
                </div>
              </div>
            </li>
          </ul>
        </UCard>

        <CompanionToolsCard />
      </div>
    </template>
  </UDashboardPanel>
</template>
