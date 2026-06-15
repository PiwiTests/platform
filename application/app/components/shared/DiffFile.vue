<script setup lang="ts">
import type { ScmChangedFile } from '~~/types/api';

defineProps<{
  file: ScmChangedFile;
}>();
</script>

<template>
  <div class="border border-default rounded-lg overflow-clip text-xs font-mono">
    <!-- Sticky file header -->
    <div
      class="sticky top-0 z-10 flex items-center justify-between px-3 py-1.5 bg-elevated border-b border-default text-gray-600 dark:text-gray-300"
    >
      <span class="font-medium truncate">{{ file.filename }}</span>
      <span class="shrink-0 flex items-center gap-1.5 ml-2 text-[11px]">
        <span v-if="file.additions" class="text-green-600 dark:text-green-400">+{{ file.additions }}</span>
        <span v-if="file.deletions" class="text-red-600 dark:text-red-400">-{{ file.deletions }}</span>
        <UBadge :label="file.status" size="xs" variant="subtle" :color="scmFileStatusMeta(file.status).badgeColor" />
      </span>
    </div>
    <!-- Patch lines -->
    <DiffPatch v-if="file.patch" :patch="file.patch" />
    <div v-else class="px-3 py-2 text-gray-400 text-[11px]">No patch available</div>
  </div>
</template>
