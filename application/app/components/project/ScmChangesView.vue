<script setup lang="ts">
import type { ScmChanges } from '~~/types/api';

defineProps<{
  changes: ScmChanges;
}>();

const expandedFiles = ref<Set<string>>(new Set());

function toggle(filename: string) {
  const next = new Set(expandedFiles.value);
  if (next.has(filename)) next.delete(filename);
  else next.add(filename);
  expandedFiles.value = next;
}
</script>

<template>
  <div class="space-y-3">
    <!-- Commits -->
    <div v-if="changes.commits.length > 0" class="space-y-1">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
        {{ changes.commits.length }} commit{{ changes.commits.length === 1 ? '' : 's' }}
      </p>
      <div class="rounded-md border border-default overflow-hidden divide-y divide-default">
        <div v-for="commit in changes.commits" :key="commit.sha" class="flex items-center gap-2 px-3 py-1.5">
          <UIcon name="i-lucide-git-commit-horizontal" class="size-3.5 text-gray-400 shrink-0" />
          <code class="text-xs text-gray-400 shrink-0">{{ commit.sha.slice(0, 7) }}</code>
          <span class="text-xs text-gray-700 dark:text-gray-300 truncate">{{ commit.message }}</span>
        </div>
      </div>
    </div>

    <!-- Files -->
    <div class="space-y-1">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
        {{ changes.files.length }} file{{ changes.files.length === 1 ? '' : 's' }} changed
        <span v-if="changes.patchesOmitted" class="text-yellow-500 font-normal normal-case">
          — diff too large, file names only
        </span>
      </p>
      <div class="rounded-md border border-default overflow-hidden divide-y divide-default">
        <div v-for="file in changes.files" :key="file.filename">
          <!-- File row -->
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            :class="file.patch ? 'cursor-pointer' : 'cursor-default'"
            @click="file.patch && toggle(file.filename)"
          >
            <UIcon
              :name="scmFileStatusMeta(file.status).icon"
              class="size-3.5 shrink-0"
              :class="scmFileStatusMeta(file.status).color"
            />
            <span class="text-xs font-mono flex-1 truncate text-gray-700 dark:text-gray-300">
              {{ file.filename }}
            </span>
            <span class="text-xs text-gray-400 shrink-0 tabular-nums">
              <span v-if="file.additions" class="text-green-500">+{{ file.additions }}</span>
              <span v-if="file.additions && file.deletions" class="text-gray-300 mx-0.5">/</span>
              <span v-if="file.deletions" class="text-red-500">-{{ file.deletions }}</span>
            </span>
            <UIcon
              v-if="file.patch"
              :name="expandedFiles.has(file.filename) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-3.5 text-gray-400 shrink-0"
            />
          </button>

          <!-- Diff -->
          <div
            v-if="file.patch && expandedFiles.has(file.filename)"
            class="border-t border-default overflow-x-auto max-h-96"
          >
            <DiffPatch :patch="file.patch" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
