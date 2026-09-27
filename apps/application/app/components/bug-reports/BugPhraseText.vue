<script setup lang="ts">
/** A sentence from core's bug phrasebook, with its code spans in mono. */
import { codeSpanParts } from '~/utils/bug-reports';

const props = defineProps<{ text: string }>();
const parts = computed(() => codeSpanParts(props.text));
</script>

<template>
  <span
    ><template v-for="(part, i) in parts" :key="i"
      ><span v-if="part.code" class="font-mono text-[0.92em]">{{ part.text }}</span
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>
