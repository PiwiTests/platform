<script setup lang="ts">
/**
 * "Fixed before" — the resolved clusters this open one resembles, one line each:
 * when it was resolved, the commit that fixed it, how long it stayed open, why it
 * matched, and a one-click "Apply the same triage" that copies the earlier
 * cluster's triage note onto this one.
 */
import type { FixedBeforeMatch } from '#shared/fix-plan.types';
import { formatRelativeTime, formatLongDuration } from '~/utils';

defineProps<{
  matches: FixedBeforeMatch[];
  /** Reporter/admin — whether the apply action is offered. */
  canWrite: boolean;
  /** The cluster id currently being applied, so its button shows a spinner. */
  applyingId?: number | null;
}>();

const emit = defineEmits<{ apply: [match: FixedBeforeMatch] }>();

function onApply(match: FixedBeforeMatch) {
  emit('apply', match);
}
</script>

<template>
  <div class="space-y-3" data-shot="fixed-before">
    <p class="text-xs text-muted">
      Resolved failures that resemble this one — how they were fixed, so you can reuse the same triage.
    </p>
    <ul class="space-y-3">
      <li
        v-for="m in matches"
        :key="m.clusterId"
        class="rounded-md border border-default p-2.5 space-y-1.5"
        :data-shot="`fixed-before-${m.clusterId}`"
      >
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <NuxtLink :to="`/failure-clusters/${m.clusterId}`" class="text-sm font-medium text-primary hover:underline">
            #{{ m.clusterId }} {{ m.title }}
          </NuxtLink>
          <UBadge color="neutral" variant="subtle" size="sm">{{ m.reason }}</UBadge>
        </div>

        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <ClientOnly>
            <span v-if="m.resolvedAt">Fixed {{ formatRelativeTime(m.resolvedAt) }}</span>
          </ClientOnly>
          <template v-if="m.fixCommit">
            <span aria-hidden="true">·</span>
            <a
              v-if="m.fixCommitUrl"
              :href="m.fixCommitUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-mono text-primary hover:underline"
              :title="`View commit ${m.fixCommit}`"
            >
              {{ m.fixCommitShort }}
            </a>
            <code v-else class="font-mono">{{ m.fixCommitShort }}</code>
          </template>
          <template v-if="m.openMs != null">
            <span aria-hidden="true">·</span>
            <span :title="`Open for ${formatLongDuration(m.openMs)}`">open {{ formatLongDuration(m.openMs) }}</span>
          </template>
          <template v-if="m.diagnosisFeedback">
            <span aria-hidden="true">·</span>
            <UIcon
              :name="m.diagnosisFeedback === 'up' ? 'i-lucide-thumbs-up' : 'i-lucide-thumbs-down'"
              class="size-3.5"
              :class="m.diagnosisFeedback === 'up' ? 'text-success' : 'text-warning'"
              :title="m.diagnosisFeedback === 'up' ? 'Diagnosis marked helpful' : 'Diagnosis marked unhelpful'"
            />
          </template>
        </div>

        <p v-if="m.diagnosisTitle" class="text-xs text-toned line-clamp-2">
          <span class="text-muted">Diagnosis:</span> {{ m.diagnosisTitle }}
        </p>
        <p v-if="m.triageNote" class="text-xs text-toned line-clamp-2 italic">“{{ m.triageNote }}”</p>

        <div v-if="canWrite" class="pt-0.5">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-copy"
            :loading="applyingId === m.clusterId"
            title="Copy this cluster's triage note onto the current cluster"
            @click="onApply(m)"
          >
            Apply the same triage
          </UButton>
        </div>
      </li>
    </ul>
  </div>
</template>
