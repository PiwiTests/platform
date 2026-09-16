<script setup lang="ts">
const props = defineProps<{
  icon: string;
  label: string;
  count?: number | null;
  collapsible?: boolean;
  /** Drop the bordered frame — render a plain heading row over the body. */
  embedded?: boolean;
}>();

const open = defineModel<boolean>('open', { default: false });
const isOpen = computed(() => props.collapsible === false || open.value);
</script>

<template>
  <div v-if="embedded">
    <div class="flex items-center gap-1.5 mb-1.5">
      <UIcon :name="icon" class="size-4 shrink-0 text-primary/70" />
      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ label }}<span v-if="count != null" class="text-gray-400 font-normal ml-1">({{ count }})</span>
      </span>
    </div>
    <slot />
  </div>

  <div v-else class="rounded-md border border-default overflow-hidden">
    <component
      :is="collapsible === false ? 'div' : 'button'"
      class="w-full flex items-center gap-1.5 px-3 py-2 bg-elevated border-b border-default text-left"
      :class="collapsible !== false && 'hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer'"
      @click="collapsible !== false && (open = !open)"
    >
      <UIcon :name="icon" class="size-3.5 shrink-0 text-primary/70" />
      <span class="text-xs font-semibold text-gray-600 dark:text-gray-300 flex-1">
        {{ label }}<span v-if="count != null" class="text-gray-400 font-normal ml-1">({{ count }})</span>
      </span>
      <UIcon
        v-if="collapsible !== false"
        :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="size-3.5 text-gray-400"
      />
    </component>
    <div v-if="isOpen">
      <slot />
    </div>
  </div>
</template>
