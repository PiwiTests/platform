<script setup lang="ts">
/**
 * Every locator chain the project's tests use, the chains shared by the most
 * tests first, with a text filter. Each row opens "Who uses this?".
 */
import type { LocatorIndex } from '#shared/locator-index';

const props = defineProps<{ index: LocatorIndex }>();
const emit = defineEmits<{ inspect: [locator: string] }>();

const PAGE = 50;
const search = ref('');
const shown = ref(PAGE);
watch(search, () => (shown.value = PAGE));

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return props.index.locators
    .filter((entry) => !q || entry.locator.toLowerCase().includes(q))
    .map((entry) => ({
      entry,
      tests: new Set(entry.uses.map((u) => u.test)).size,
      actions: [...new Set(entry.uses.flatMap((u) => u.actions))],
    }));
});
</script>

<template>
  <div class="space-y-3" data-shot="locator-list">
    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Filter locators"
      aria-label="Filter locators"
      class="w-full sm:max-w-sm"
    />
    <EmptyState v-if="rows.length === 0" icon="i-lucide-crosshair" text="No locator matches the filter." />
    <ul v-else class="divide-y divide-default border-y border-default">
      <li
        v-for="row in rows.slice(0, shown)"
        :key="row.entry.locator"
        class="py-2.5 flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <LocatorCode :locator="row.entry.locator" class="text-sm" />
          <p class="text-xs text-muted">
            {{ row.actions.slice(0, 4).map(locatorActionLabel).join(', ')
            }}<template v-if="row.actions.length > 4"> and {{ row.actions.length - 4 }} more</template> · last seen
            {{ formatRelativeTime(row.entry.lastSeenAt) }}
          </p>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          size="xs"
          class="self-start shrink-0"
          :title="`Who uses ${row.entry.locator}?`"
          @click="emit('inspect', row.entry.locator)"
        >
          <span class="tabular-nums">{{ row.tests }}</span>
          {{ row.tests === 1 ? 'test' : 'tests' }}
        </UButton>
      </li>
    </ul>
    <div v-if="rows.length > shown" class="flex items-center gap-3">
      <UButton color="neutral" variant="outline" size="sm" @click="shown += PAGE">Show more</UButton>
      <span class="text-xs text-muted">{{ rows.length - shown }} more</span>
    </div>
    <p v-if="index.truncated" class="text-xs text-muted">
      The project has more locators than the list carries; the least used are left out.
    </p>
  </div>
</template>
