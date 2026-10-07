<script setup lang="ts">
import { cloneVNode, type VNode } from 'vue';

/**
 * A `UTooltip` built on the first pointer entry of its trigger; its props and
 * `content` slot are the UTooltip's. A closed UTooltip still builds its popper,
 * portal and content, so a list giving each row a few of them builds hundreds
 * for the one a pointer rests on. The trigger must take no focus: it renders
 * anew once the tooltip is built, and opens on the pointer's next move.
 */
defineOptions({ inheritAttrs: false });

const slots = defineSlots<{ default(): VNode[]; content?(props: Record<string, unknown>): VNode[] }>();
const built = ref(false);

/** The slot's element, waiting for the pointer. */
function Trigger() {
  const [trigger] = slots.default();
  return trigger ? cloneVNode(trigger, { onPointerenter: () => (built.value = true) }) : null;
}
</script>

<template>
  <UTooltip v-if="built" v-bind="$attrs">
    <slot />
    <template v-if="slots.content" #content="scope">
      <slot name="content" v-bind="scope" />
    </template>
  </UTooltip>
  <Trigger v-else />
</template>
