<script setup lang="ts">
export interface DetailTabItem {
  label: string;
  icon?: string;
  value: string;
  slot?: string;
}

const props = defineProps<{
  tabItems: DetailTabItem[];
  tabPanelClass?: Record<string, string>;
}>();

const activeTab = defineModel<string>({ required: true });
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden gap-4 p-1">
    <div v-if="$slots.summary" class="shrink-0">
      <slot name="summary" />
    </div>

    <UTabs v-model="activeTab" :items="tabItems" size="sm" class="shrink-0" />

    <template v-for="item in tabItems" :key="item.value">
      <div
        v-if="activeTab === item.value"
        class="flex-1 min-h-0"
        :class="tabPanelClass?.[item.value] ?? 'overflow-y-auto'"
      >
        <slot :name="`tab-${item.slot ?? item.value}`" />
      </div>
    </template>
  </div>
</template>
