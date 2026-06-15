<script setup lang="ts">
import type { DemoScenario } from '~/demo/simulator';

/**
 * Scenario launcher for the demo run simulator, rendered inside the demo
 * banner. Lets visitors replay different kinds of live test runs as if a
 * Piwi reporter were streaming them in (see app/demo/simulator.ts).
 */

const { state, scenarios, start, stop, cancelStaleRuns } = useDemoSimulator();

// Demo DB readiness — flipped by the first successful API call (demo-fetch plugin)
const demoReady = useState('demoReady', () => false);

const popoverOpen = ref(false);

onMounted(() => {
  // Clean up runs orphaned by a reload mid-simulation. $fetch waits for the
  // service worker to claim the page, so this is safe to call right away.
  cancelStaleRuns();
});

function launch(scenario: DemoScenario) {
  popoverOpen.value = false;
  start(scenario);
}
</script>

<template>
  <div class="flex items-center gap-2">
    <template v-if="state.status === 'idle'">
      <UPopover v-model:open="popoverOpen">
        <UButton
          size="xs"
          color="warning"
          variant="solid"
          icon="i-lucide-radio-tower"
          trailing-icon="i-lucide-chevron-down"
          label="Simulate a test run"
          :disabled="!demoReady"
        />

        <template #content>
          <div class="p-2 w-80">
            <p class="text-xs text-muted px-2 py-1.5">
              Watch a live run arrive, as if a Piwi reporter were streaming it from CI.
            </p>
            <button
              v-for="scenario in scenarios"
              :key="scenario.id"
              type="button"
              class="w-full flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-elevated transition-colors"
              @click="launch(scenario)"
            >
              <UIcon :name="scenario.icon" class="size-4.5 mt-0.5 shrink-0 text-muted" />
              <span class="flex flex-col">
                <span class="text-sm font-medium text-highlighted">{{ scenario.label }}</span>
                <span class="text-xs text-muted">{{ scenario.description }}</span>
              </span>
            </button>
          </div>
        </template>
      </UPopover>
    </template>

    <template v-else>
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin shrink-0" />
      <span class="text-sm whitespace-nowrap">
        {{ state.scenario?.label }} —
        <template v-if="state.total > 0">{{ state.completed }}/{{ state.total }} tests</template>
        <template v-else>starting…</template>
      </span>
      <UBadge v-if="state.failed > 0" color="error" variant="subtle" size="sm"> {{ state.failed }} failed </UBadge>
      <UButton
        v-if="state.runId"
        size="xs"
        color="warning"
        variant="solid"
        icon="i-lucide-eye"
        label="View run"
        :to="`/test-runs/${state.runId}`"
      />
      <UButton
        size="xs"
        color="warning"
        variant="outline"
        icon="i-lucide-square"
        label="Stop"
        :loading="state.status === 'stopping'"
        @click="stop"
      />
    </template>
  </div>
</template>
