<script setup lang="ts">
defineProps<{
  patch: string;
}>();
</script>

<template>
  <div class="overflow-x-auto text-xs font-mono">
    <div
      v-for="(line, i) in parsePatchLines(patch)"
      :key="i"
      class="px-3 py-px whitespace-pre leading-5 min-w-0"
      :class="patchLineClass[line.type]"
    >
      {{ line.text || ' ' }}
    </div>
  </div>
</template>
