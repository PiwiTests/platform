<script setup lang="ts">
import type { EntityLinkInfo } from '~~/types/api';

defineProps<{
  testRun?: {
    environment?: string | null;
    status: string;
    startTime: string | Date;
  } | null;
  scmInfo?: {
    commit?: string;
    branch?: string;
    author?: string;
    commitMessage?: string;
  } | null;
  ciInfo?: {
    provider?: string;
    buildNumber?: string;
    buildUrl?: string;
    workflow?: string;
  } | null;
  browserInfo?: {
    browserName?: string;
    viewport?: { width?: number; height?: number };
  } | null;
  entityId?: number | null;
  links?: EntityLinkInfo[] | null;
}>();
</script>

<template>
  <SectionCard v-if="testRun" icon="i-lucide-info" title="Run context">
    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide">Environment</p>
        <UBadge v-if="testRun.environment" color="neutral" variant="soft">
          {{ testRun.environment }}
        </UBadge>
        <span v-else class="text-gray-400">—</span>
      </div>
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide">Run status</p>
        <UBadge :color="getStatusColor(testRun.status)">
          {{ testRun.status }}
        </UBadge>
      </div>
      <div>
        <p class="text-xs text-gray-500 uppercase tracking-wide">Started</p>
        <p class="text-sm">
          {{ formatRelativeTime(testRun.startTime) }}
        </p>
      </div>

      <div v-if="browserInfo?.browserName">
        <p class="text-xs text-gray-500 uppercase tracking-wide">Browser</p>
        <p class="text-sm capitalize">
          {{ browserInfo.browserName }}
        </p>
      </div>
      <div v-if="browserInfo?.viewport">
        <p class="text-xs text-gray-500 uppercase tracking-wide">Viewport</p>
        <p class="text-sm">{{ browserInfo.viewport.width }}×{{ browserInfo.viewport.height }}</p>
      </div>

      <div v-if="ciInfo?.provider">
        <p class="text-xs text-gray-500 uppercase tracking-wide">CI provider</p>
        <p class="text-sm">
          {{ ciInfo.provider }}
        </p>
      </div>
      <div v-if="ciInfo?.buildNumber">
        <p class="text-xs text-gray-500 uppercase tracking-wide">CI build</p>
        <a v-if="ciInfo.buildUrl" :href="ciInfo.buildUrl" target="_blank" class="text-sm text-primary hover:underline"
          >#{{ ciInfo.buildNumber }}</a
        >
        <p v-else class="text-sm">#{{ ciInfo.buildNumber }}</p>
      </div>
      <div v-if="ciInfo?.workflow">
        <p class="text-xs text-gray-500 uppercase tracking-wide">Workflow</p>
        <p class="text-sm">
          {{ ciInfo.workflow }}
        </p>
      </div>

      <div v-if="scmInfo?.branch">
        <p class="text-xs text-gray-500 uppercase tracking-wide">Branch</p>
        <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ scmInfo.branch }}</code>
      </div>
      <div v-if="scmInfo?.commit">
        <p class="text-xs text-gray-500 uppercase tracking-wide">Commit</p>
        <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">{{
          scmInfo.commit.substring(0, 8)
        }}</code>
      </div>
      <div v-if="scmInfo?.author">
        <p class="text-xs text-gray-500 uppercase tracking-wide">Author</p>
        <p class="text-sm">
          {{ scmInfo.author }}
        </p>
      </div>
    </div>
    <div v-if="entityId" class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
      <p class="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Links</p>
      <EntityLinks entity-type="test_runs_case" :entity-id="entityId" :links="links ?? null" />
    </div>
  </SectionCard>
</template>
