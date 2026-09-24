<script setup lang="ts">
/**
 * Every locator an execution used, in step order, read from its stored steps:
 * the action, the call site and the full chain, with how many tests in the
 * project use the same chain. Opening a row asks who else uses it — the same
 * chain, the same target inside other containers, or anything inside one of
 * its containers.
 */
import type { ExecutionLocatorUse, ExecutionLocatorsResult } from '#shared/locator-usages.types';

const props = defineProps<{
  testRunsCaseId: number;
  projectKey?: string | number;
  projectName?: string;
}>();

const data = ref<ExecutionLocatorsResult | null>(null);
const pending = ref(false);
const failed = ref(false);

watch(
  () => props.testRunsCaseId,
  async (id) => {
    if (!id) return;
    pending.value = true;
    failed.value = false;
    try {
      data.value = await $fetch<ExecutionLocatorsResult>(`/api/test-run-cases/${id}/locators`);
    } catch {
      failed.value = true;
    } finally {
      pending.value = false;
    }
  },
  { immediate: true },
);

const selected = ref<ExecutionLocatorUse | null>(null);
const drawerOpen = ref(false);

function openUse(use: ExecutionLocatorUse) {
  selected.value = use;
  drawerOpen.value = true;
}

function usedByTitle(use: ExecutionLocatorUse): string {
  const more = use.sameTargetTests - use.sameLocatorTests;
  return more > 0
    ? `${use.sameLocatorTests} tests use this exact chain; ${more} more reach ${use.target} through other containers`
    : `${use.sameLocatorTests} tests use this exact chain`;
}
</script>

<template>
  <div data-shot="execution-locators">
    <LoadingState v-if="pending && !data" text="Reading the locators…" />
    <ErrorState v-else-if="failed" text="Could not load the locators of this execution." />
    <EmptyState
      v-else-if="!data || data.uses.length === 0"
      icon="i-lucide-crosshair"
      :text="
        data && !data.hasSteps
          ? 'No steps were recorded for this execution.'
          : 'This execution used no locators Playwright reports.'
      "
    />
    <template v-else>
      <p class="text-xs text-muted mb-2">
        Every locator this test used, in order. The count is how many tests in the project use the same chain.
      </p>
      <ol class="divide-y divide-default">
        <li
          v-for="(use, i) in data.uses"
          :key="`${use.callSite}|${use.action}|${use.locator}`"
          class="py-2.5 flex flex-col gap-2 sm:flex-row sm:items-start"
        >
          <span class="hidden sm:block w-6 shrink-0 pt-0.5 text-xs text-muted tabular-nums">{{ i + 1 }}</span>
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span>{{ locatorActionLabel(use.action) }}</span>
              <span v-if="use.occurrences > 1" class="tabular-nums">× {{ use.occurrences }}</span>
              <OpenInIdeLink
                v-if="use.callSite"
                :location="use.callSite"
                :project-key="projectKey"
                :project-name="projectName"
              />
            </div>
            <LocatorCode :locator="use.locator" class="text-sm" />
          </div>
          <UButton
            color="neutral"
            variant="outline"
            size="xs"
            class="self-start shrink-0"
            :title="usedByTitle(use)"
            @click="openUse(use)"
          >
            <span class="tabular-nums">{{ use.sameLocatorTests }}</span>
            {{ use.sameLocatorTests === 1 ? 'test' : 'tests' }}
          </UButton>
        </li>
      </ol>
    </template>

    <LocatorUsageDrawer
      v-model:open="drawerOpen"
      :use="selected"
      :project-id="data?.projectId ?? null"
      :project-key="projectKey"
      :project-name="projectName"
    />
  </div>
</template>
