<script setup lang="ts">
/**
 * Responsive breadcrumb — the page title of every detail page, so the navbar
 * never repeats it. From `sm` up it renders the standard `UBreadcrumb` (any
 * custom item slots forwarded) and takes the room the navbar actions leave:
 * ancestors keep their natural width (capped) and the current page label
 * takes the rest, down to a readable floor. Below `2xl` the root keeps just
 * its icon and the middle levels beyond the nearest two ancestors are hidden,
 * so a deep path still reads on a laptop next to the actions. Below `sm` the ancestors collapse into a
 * dropdown and only the current page label shows — tapping the leading chip
 * reveals the full path. Drop-in replacement for `<UBreadcrumb :items>`.
 */
import type { BreadcrumbItem, DropdownMenuItem } from '@nuxt/ui';

const props = defineProps<{ items: BreadcrumbItem[] }>();

const current = computed(() => props.items[props.items.length - 1]);

// Every level except the current page, as dropdown links.
const ancestorItems = computed<DropdownMenuItem[]>(() =>
  props.items.slice(0, -1).map((item) => ({
    label: typeof item.label === 'string' ? item.label : String(item.label ?? ''),
    icon: item.icon,
    to: item.to as string | undefined,
  })),
);

const hasAncestors = computed(() => ancestorItems.value.length > 0);

// The ancestors are the path and stay readable: natural width, capped so a
// long project name ellipsizes (an item with a custom slot sizes itself).
// The current page label is the title and takes the remaining room, down to
// a floor, truncating from the end. Below `2xl` the root keeps its icon only
// and the middle levels hide, together with the separator each one owns.
// Every level needs `min-w-0` for the truncation to take effect.
const desktopItems = computed(() => {
  const count = props.items.length;
  return props.items.map((item, index) => {
    if (index === count - 1) return { ...item, class: 'truncate', ui: { ...item.ui, item: 'min-w-40' } };
    const rootIconOnly = index === 0 && item.icon ? 'max-2xl:sr-only' : '';
    const hidden = index > 0 && index < count - 3 ? 'max-2xl:hidden' : '';
    return {
      ...item,
      class: item.slot ? undefined : 'max-w-48',
      ui: {
        ...item.ui,
        item: ['shrink-0', hidden].join(' ').trim(),
        separator: hidden,
        linkLabel: ['truncate', rootIconOnly].join(' ').trim(),
      },
    };
  });
});
</script>

<template>
  <!-- Desktop: full breadcrumb, forwarding any custom per-item slots (e.g. #project). -->
  <UBreadcrumb
    :items="desktopItems"
    class="hidden min-w-0 flex-1 overflow-hidden sm:flex"
    :ui="{ root: 'min-w-0', list: 'min-w-0', item: 'min-w-0', link: 'min-w-0', separator: 'shrink-0' }"
  >
    <template v-for="(_, name) in $slots" #[name]="slotData">
      <slot :name="name" v-bind="slotData ?? {}" />
    </template>
  </UBreadcrumb>

  <!-- Mobile: ancestor dropdown + current page. -->
  <div class="flex min-w-0 items-center gap-1 sm:hidden">
    <UDropdownMenu v-if="hasAncestors" :items="ancestorItems" :content="{ align: 'start', collisionPadding: 12 }">
      <UButton
        :icon="items[0]?.icon || 'i-lucide-ellipsis'"
        trailing-icon="i-lucide-chevron-down"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        aria-label="Show navigation path"
        class="shrink-0"
      />
    </UDropdownMenu>
    <UIcon v-if="hasAncestors" name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted" />
    <span class="truncate text-sm font-medium">
      <slot :name="current?.slot || 'current'" :item="current">{{ current?.label }}</slot>
    </span>
  </div>
</template>
