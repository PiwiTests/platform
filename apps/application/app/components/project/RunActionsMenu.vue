<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';

const props = defineProps<{
  /** The trigger's accessible name (`Run #12 actions`). */
  label: string;
  /** The menu's items, read when it opens. */
  items: () => DropdownMenuItem[];
}>();

// A runs list holds dozens of these, so the menu mounts on its first click:
// until then the row carries only its trigger button.
const used = ref(false);
const open = ref(false);

function openMenu() {
  used.value = true;
  open.value = true;
}
</script>

<template>
  <UDropdownMenu v-if="used" v-model:open="open" :items="props.items()" :content="{ align: 'end' }">
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-ellipsis-vertical"
      :aria-label="label"
      @click.stop
    />
  </UDropdownMenu>
  <UButton
    v-else
    size="xs"
    color="neutral"
    variant="ghost"
    icon="i-lucide-ellipsis-vertical"
    :aria-label="label"
    aria-haspopup="menu"
    @click.stop="openMenu"
  />
</template>
