<script setup lang="ts">
interface ScmInfo {
  branch?: string;
  commit?: string;
  author?: string;
  commitMessage?: string;
}

defineProps<{
  scm: ScmInfo;
  class?: string;
}>();
</script>

<template>
  <BlockCard :class="$props.class" title="Source" icon="i-lucide-git-branch">
    <div class="space-y-1.5 text-sm">
      <div v-if="scm.branch" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-git-branch" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span class="font-medium">{{ scm.branch }}</span>
      </div>
      <div v-if="scm.commit" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-git-commit-horizontal" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <code class="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">{{
          scm.commit.length >= 8 ? scm.commit.substring(0, 8) : scm.commit
        }}</code>
      </div>
      <div v-if="scm.author" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-user" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span class="text-gray-600 dark:text-gray-400">{{ scm.author }}</span>
      </div>
      <p v-if="scm.commitMessage" class="text-gray-400 text-xs break-words pl-1">
        {{ scm.commitMessage }}
      </p>
    </div>
  </BlockCard>
</template>
