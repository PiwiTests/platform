<script setup lang="ts">
const props = defineProps<{
  testCase: {
    id: number;
    title?: string | null;
    location?: string | null;
    status: string;
    duration?: number | null;
    retries?: number | null;
    workerIndex?: number | null;
    slowestStep?: string | null;
    slowestStepDuration?: number | null;
  };
  historicalTiming?: {
    avg: number;
    current: number;
    diff: number;
    pct: number;
  } | null;
}>();

const copySuccess = ref(false);

async function copyLocation() {
  if (!props.testCase.location) return;
  try {
    await navigator.clipboard.writeText(props.testCase.location);
    copySuccess.value = true;
    setTimeout(() => {
      copySuccess.value = false;
    }, 2000);
  } catch {
    // Clipboard not available
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-semibold">Test case #{{ testCase.id }}</h2>
        <div class="flex items-center gap-2">
          <UBadge :color="getStatusColor(testCase.status)" size="lg">
            {{ testCase.status }}
          </UBadge>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <div>
        <p class="text-sm text-gray-500">Title</p>
        <p class="font-medium text-lg">
          {{ testCase.title }}
        </p>
      </div>

      <div v-if="testCase.location">
        <p class="text-sm text-gray-500">Location</p>
        <div class="flex items-center gap-2">
          <code class="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded block flex-1">{{ testCase.location }}</code>
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            :title="copySuccess ? 'Copied!' : 'Copy location'"
            @click="copyLocation()"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p class="text-sm text-gray-500">Duration</p>
          <p class="font-medium">
            {{ formatDuration(testCase.duration) }}
          </p>
        </div>
        <div>
          <p class="text-sm text-gray-500">Retries</p>
          <p class="font-medium">
            {{ testCase.retries ?? 0 }}
          </p>
        </div>
        <div v-if="testCase.workerIndex !== null && testCase.workerIndex !== undefined">
          <p class="text-sm text-gray-500">Worker</p>
          <UBadge color="neutral" variant="soft"> #{{ testCase.workerIndex }} </UBadge>
        </div>
        <div v-if="testCase.slowestStep">
          <p class="text-sm text-gray-500">Slowest step</p>
          <p class="font-medium text-orange-600">
            {{ testCase.slowestStep }}
            <span v-if="testCase.slowestStepDuration" class="text-sm"
              >({{ formatDuration(testCase.slowestStepDuration) }})</span
            >
          </p>
        </div>
      </div>

      <div v-if="historicalTiming" class="pt-3 border-t">
        <p class="text-sm text-gray-500 mb-1">Duration vs historical average</p>
        <p class="font-medium">
          <span
            :class="
              historicalTiming.pct > 10
                ? 'text-red-600'
                : historicalTiming.pct < -10
                  ? 'text-green-600'
                  : 'text-gray-500'
            "
          >
            {{ formatDuration(historicalTiming.current) }}
          </span>
          <span class="text-gray-400 mx-1">vs</span>
          <span class="text-gray-500">{{ formatDuration(historicalTiming.avg) }}</span>
          <span class="ml-2 text-sm" :class="historicalTiming.pct > 0 ? 'text-red-500' : 'text-green-500'">
            {{ historicalTiming.pct > 0 ? '+' : '' }}{{ historicalTiming.pct }}%
          </span>
        </p>
      </div>
    </div>
  </UCard>
</template>
