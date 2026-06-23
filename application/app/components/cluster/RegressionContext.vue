<script setup lang="ts">
import type { RegressionContext } from '~~/types/api';

const route = useRoute();
const runId = route.params.id;

const { data: context, pending: loading } = await useFetch<RegressionContext>(
  `/api/test-runs/${runId}/regression-context`,
  { lazy: true, server: false },
);

const { copy, copied } = useCopy();

function copyCommand() {
  copy(context.value?.commitRange?.gitCommand);
}
</script>

<template>
  <div class="pt-4">
    <LoadingState v-if="loading" text="Looking for last passing run…" />

    <EmptyState
      v-else-if="!context?.hasGreen"
      icon="i-lucide-history"
      text="No previous passing run found for this project"
    />

    <template v-else>
      <div class="space-y-4">
        <!-- Last green run header -->
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UIcon name="i-lucide-circle-check" class="size-4 text-green-500 shrink-0" />
          <span class="text-gray-500 inline-flex items-center gap-1"
            >Last passing run: <HelpHint topic="run.regression"
          /></span>
          <NuxtLink :to="`/test-runs/${context.lastGreenRunId}`" class="font-medium text-primary hover:underline">
            Run #{{ context.lastGreenRunId }}
          </NuxtLink>
          <span v-if="context.lastGreenRunAt" class="text-gray-400">
            ({{ formatRelativeTime(context.lastGreenRunAt) }})
          </span>
        </div>

        <!-- Impact: new failures -->
        <div v-if="(context.newFailures ?? 0) > 0" class="flex flex-wrap items-center gap-2">
          <UBadge color="error" variant="soft" size="lg">
            {{ context.newFailures }} new {{ context.newFailures === 1 ? 'failure' : 'failures' }}
          </UBadge>
          <span class="text-sm text-gray-500">
            {{ context.newFailures === 1 ? 'test' : 'tests' }} that
            {{ context.newFailures === 1 ? 'passed' : 'passed' }} in run #{{ context.lastGreenRunId }} but
            {{ context.newFailures === 1 ? 'fails' : 'fail' }} here
          </span>
        </div>
        <div v-else class="flex items-center gap-2">
          <UBadge color="warning" variant="soft" size="lg"> No new regressions </UBadge>
          <span class="text-sm text-gray-500"
            >All failing tests were also failing before run #{{ context.lastGreenRunId }}</span
          >
        </div>

        <!-- Commit range -->
        <UCard v-if="context.commitRange" :ui="{ body: 'p-4 sm:p-4' }">
          <div class="space-y-3">
            <div class="flex items-center gap-2 text-sm font-medium">
              <UIcon name="i-lucide-git-commit-horizontal" class="size-4" />
              Commits introduced since last passing run
            </div>

            <div class="flex flex-wrap items-center gap-2 text-sm font-mono">
              <UBadge color="success" variant="soft" size="sm">
                {{ context.commitRange.fromShort }}
              </UBadge>
              <UIcon name="i-lucide-arrow-right" class="size-3 text-gray-400" />
              <UBadge color="error" variant="soft" size="sm">
                {{ context.commitRange.toShort }}
              </UBadge>
              <span v-if="context.currentBranch || context.lastGreenBranch" class="text-xs text-gray-400 font-sans">
                on {{ context.currentBranch || context.lastGreenBranch }}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UButton
                v-if="context.commitRange.compareUrl"
                :to="context.commitRange.compareUrl"
                target="_blank"
                external
                icon="i-lucide-external-link"
                size="sm"
                variant="soft"
                color="primary"
              >
                View commits
              </UButton>

              <div class="flex items-center gap-1.5 flex-1 min-w-0">
                <code
                  class="flex-1 text-xs bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded font-mono truncate select-all"
                >
                  {{ context.commitRange.gitCommand }}
                </code>
                <UButton
                  :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :title="copied ? 'Copied!' : 'Copy git command'"
                  @click="copyCommand"
                />
              </div>
            </div>
          </div>
        </UCard>

        <div
          v-else-if="!context.currentCommit || !context.lastGreenCommit"
          class="text-sm text-gray-500 flex items-center gap-2"
        >
          <UIcon name="i-lucide-git-branch" class="size-4 shrink-0" />
          No commit info available — enable <code class="font-mono text-xs">collectScmInfo: true</code> in the reporter
          to see commit ranges
        </div>

        <!-- Metadata changes -->
        <UCard v-if="context.metadataDiff && context.metadataDiff.length > 0" :ui="{ body: 'p-0 sm:p-0' }">
          <div class="px-4 py-3 text-sm font-medium flex items-center gap-2 border-b border-default">
            <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
            What changed between runs
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="text-xs text-gray-500 uppercase tracking-wider border-b border-default">
                <th class="text-left px-4 py-2 font-medium w-32">Field</th>
                <th class="text-left px-4 py-2 font-medium">Last passing</th>
                <th class="text-left px-4 py-2 font-medium">This run</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in context.metadataDiff"
                :key="entry.key"
                class="border-b last:border-b-0 border-default"
              >
                <td class="px-4 py-2 text-gray-500">
                  {{ entry.label }}
                </td>
                <td class="px-4 py-2 font-mono text-xs">
                  <span v-if="entry.before" class="text-green-700 dark:text-green-400">{{ entry.before }}</span>
                  <span v-else class="text-gray-400">—</span>
                </td>
                <td class="px-4 py-2 font-mono text-xs">
                  <span v-if="entry.after" class="text-red-700 dark:text-red-400">{{ entry.after }}</span>
                  <span v-else class="text-gray-400">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>
      </div>
    </template>
  </div>
</template>
