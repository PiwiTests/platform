<script setup lang="ts">
import type { TestCaseResult, TraceInfo, AttachmentInfo } from '~~/types/api';
import type { EntityLinkInfo } from '~~/types/api';
import type { BrowserConfig } from '~~/shared/types';

interface ScmInfo {
  commit?: string;
  branch?: string;
  author?: string;
  commitMessage?: string;
}

interface CiInfo {
  provider?: string;
  buildNumber?: string;
  buildUrl?: string;
  workflow?: string;
}

interface HistoricalTiming {
  avg: number;
  current: number;
  diff: number;
  pct: number;
}

const props = defineProps<{
  testCase: TestCaseResult | null;
  scmInfo: ScmInfo | null;
  ciInfo: CiInfo | null;
  browser: BrowserConfig | null;
  environment: string | null | undefined;
  stepsCount: number;
  historicalTiming: HistoricalTiming | null;
  traces?: TraceInfo[];
  attachments?: AttachmentInfo[];
  stableLinks?: EntityLinkInfo[] | null;
}>();

defineEmits<{
  refresh: [];
}>();

const { summaryColSpanClass, blockColSpanClass } = useDetailGrid(() => {
  let count = 0;
  if (props.scmInfo) count++;
  if (props.ciInfo || props.environment) count++;
  if (props.browser) count++;
  if ((props.traces?.length ?? 0) > 0 || (props.attachments?.length ?? 0) > 0) count++;
  count++; // Links card always visible
  return count;
});

const origin = computed(() => {
  if (import.meta.client) {
    return window.location.origin;
  }
  return useRequestURL().origin;
});

function viewerUrl(path: string): string {
  return `https://trace.playwright.dev/?trace=${encodeURIComponent(`${origin.value}/api/files/${getFileApiPath(path)}`)}`;
}

function downloadUrl(path: string): string {
  return `/api/files/${getFileApiPath(path)}`;
}

function attFileUrl(path: string, contentType?: string | null): string {
  let url = `/api/files/${getFileApiPath(path)}`;
  const ext = path.toLowerCase().split('.').pop() || '';
  if (contentType && ext === '') {
    url += `?contentType=${encodeURIComponent(contentType)}`;
  }
  return url;
}

const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const imageMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp']);

function isImage(path: string, contentType?: string | null): boolean {
  if (imageExts.has(path.toLowerCase().split('.').pop()!)) return true;
  if (contentType && imageMimes.has(contentType.toLowerCase())) return true;
  return false;
}

function totalStorageSize(traces?: TraceInfo[], attachments?: AttachmentInfo[]): number {
  let total = 0;
  if (traces)
    for (const t of traces)
      if ((t as unknown as Record<string, unknown>).size as number)
        total += (t as unknown as Record<string, unknown>).size as number;
  if (attachments) for (const a of attachments) if (a.size) total += a.size;
  return total;
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}
</script>

<template>
  <FoldableSummary storage-key="test-case">
    <template #folded>
      <StatusBlock :status="testCase?.status ?? ''" size="sm" />
      <span class="text-sm font-semibold truncate min-w-0">{{ testCase?.title }}</span>
      <div class="flex items-center gap-3 ml-auto max-sm:hidden">
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Dur: <strong class="text-gray-700 dark:text-gray-300">{{ formatDuration(testCase?.duration) }}</strong>
        </span>
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Retries: <strong class="text-gray-700 dark:text-gray-300">{{ testCase?.retries ?? 0 }}</strong>
        </span>
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Steps: <strong class="text-gray-700 dark:text-gray-300">{{ stepsCount }}</strong>
        </span>
        <span class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Worker: <strong class="text-gray-700 dark:text-gray-300">{{ testCase?.workerIndex ?? '—' }}</strong>
        </span>
        <span v-if="testCase?.shardIndex != null" class="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          Shard: <strong class="text-gray-700 dark:text-gray-300">{{ testCase.shardIndex }}</strong>
        </span>
      </div>
      <BrowserBadge v-if="browser" :browser="browser" size="sm" class="shrink-0 max-sm:hidden" />
    </template>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Main summary card -->
      <div :class="summaryColSpanClass">
        <UCard class="shadow-xs h-full">
          <div class="space-y-3">
            <div class="flex items-start gap-3">
              <StatusBlock :status="testCase?.status ?? ''" size="md" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-base font-bold truncate">
                    {{ testCase?.title }}
                  </h2>
                </div>
                <p class="text-xs text-gray-500 mt-0.5">
                  <span v-if="testCase?.location">{{ testCase.location }}</span>
                  <span v-if="historicalTiming" class="ml-2">
                    Avg {{ formatDuration(historicalTiming.avg) }} &middot;
                    <span :class="historicalTiming.diff > 0 ? 'text-red-600' : 'text-green-600'">
                      {{ historicalTiming.diff > 0 ? '+' : '' }}{{ historicalTiming.pct }}%
                    </span>
                  </span>
                </p>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ formatDuration(testCase?.duration) }}
                </p>
              </div>
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Retries</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ testCase?.retries ?? 0 }}
                </p>
              </div>
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Steps</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ stepsCount }}
                </p>
              </div>
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Worker</p>
                <p class="text-xl font-bold mt-0.5">
                  {{ testCase?.workerIndex ?? '—' }}
                </p>
              </div>
            </div>

            <div v-if="testCase?.slowestStep" class="flex items-center gap-2 text-sm">
              <UIcon name="i-lucide-zap" class="size-4 text-amber-500 shrink-0" />
              <span class="font-medium text-amber-700 dark:text-amber-300">Slowest step:</span>
              <span class="text-gray-700 dark:text-gray-300 truncate">{{ testCase.slowestStep }}</span>
              <span v-if="testCase.slowestStepDuration" class="text-gray-500 shrink-0"
                >({{ formatDuration(testCase.slowestStepDuration) }})</span
              >
            </div>
          </div>
        </UCard>
      </div>

      <!-- Source -->
      <SourceInfoCard v-if="scmInfo" :scm="scmInfo" :class="blockColSpanClass" />

      <!-- CI / Env -->
      <CiEnvCard v-if="ciInfo || environment" :ci="ciInfo" :environment="environment" :class="blockColSpanClass" />

      <!-- Browser -->
      <BlockCard v-if="browser" :class="blockColSpanClass" title="Browser" icon="i-lucide-globe">
        <div class="space-y-2">
          <div class="flex items-center gap-2 flex-wrap">
            <BrowserBadge :browser="browser ? { ...browser, viewport: undefined } : null" size="md" />
            <span v-if="browser?.channel" class="text-xs text-gray-500">{{ browser.channel }}</span>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
            <div v-if="browser?.viewport" class="flex items-center gap-1">
              <UIcon name="i-lucide-maximize-2" class="size-3 shrink-0 text-gray-400" />
              {{ browser.viewport.width }}×{{ browser.viewport.height }}
              <span v-if="browser.deviceScaleFactor && browser.deviceScaleFactor !== 1" class="text-gray-400"
                >@{{ browser.deviceScaleFactor }}x</span
              >
            </div>
            <div v-if="browser?.isMobile" class="flex items-center gap-1">
              <UIcon name="i-lucide-smartphone" class="size-3 shrink-0 text-gray-400" />
              Mobile
              <span v-if="browser.hasTouch" class="text-gray-400">· Touch</span>
            </div>
            <div v-else-if="browser?.hasTouch" class="flex items-center gap-1">
              <UIcon name="i-lucide-hand" class="size-3 shrink-0 text-gray-400" />
              Touch
            </div>
            <div v-if="browser?.locale" class="flex items-center gap-1">
              <UIcon name="i-lucide-languages" class="size-3 shrink-0 text-gray-400" />
              {{ browser.locale }}
            </div>
            <div v-if="browser?.timezoneId" class="flex items-center gap-1">
              <UIcon name="i-lucide-clock" class="size-3 shrink-0 text-gray-400" />
              {{ browser.timezoneId }}
            </div>
            <div v-if="browser?.colorScheme && browser.colorScheme !== 'light'" class="flex items-center gap-1">
              <UIcon name="i-lucide-moon" class="size-3 shrink-0 text-gray-400" />
              {{ browser.colorScheme }}
            </div>
            <div
              v-if="browser?.reducedMotion && browser.reducedMotion !== 'no-preference'"
              class="flex items-center gap-1"
            >
              <UIcon name="i-lucide-pause-circle" class="size-3 shrink-0 text-gray-400" />
              Reduced motion
            </div>
            <div v-if="browser?.offline" class="flex items-center gap-1">
              <UIcon name="i-lucide-wifi-off" class="size-3 shrink-0 text-gray-400" />
              Offline
            </div>
            <div v-if="browser?.javaScriptEnabled === false" class="flex items-center gap-1">
              <UIcon name="i-lucide-code-xml" class="size-3 shrink-0 text-gray-400" />
              JS disabled
            </div>
            <div v-if="browser?.geolocation" class="flex items-center gap-1">
              <UIcon name="i-lucide-map-pin" class="size-3 shrink-0 text-gray-400" />
              {{ browser.geolocation.latitude.toFixed(2) }}, {{ browser.geolocation.longitude.toFixed(2) }}
            </div>
          </div>
          <div
            v-if="browser?.userAgent"
            class="text-xs text-gray-400 break-all leading-snug pt-1 border-t border-default"
          >
            {{ browser.userAgent }}
          </div>
        </div>
      </BlockCard>

      <!-- Storage: traces + attachments -->
      <BlockCard
        v-if="(traces?.length ?? 0) > 0 || (attachments?.length ?? 0) > 0"
        :class="blockColSpanClass"
        title="Storage"
        icon="i-lucide-database"
        :subtitle="`${(traces?.length ?? 0) + (attachments?.length ?? 0)} files · ${formatBytes(totalStorageSize(traces, attachments))}`"
      >
        <div class="space-y-2">
          <!-- Traces -->
          <div v-for="trace in traces" :key="trace.id" class="flex items-center justify-between gap-2 py-1.5">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-file-archive" class="size-4 text-gray-400 shrink-0" />
              <span class="text-xs truncate">{{ trace.filePath.split('/').pop() }}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                :to="viewerUrl(trace.filePath)"
                target="_blank"
                icon="i-lucide-bug-play"
                size="xs"
                label="View trace"
              />
              <UButton
                :to="downloadUrl(trace.filePath)"
                target="_blank"
                icon="i-lucide-download"
                size="xs"
                color="neutral"
                variant="soft"
                label="Download"
              />
            </div>
          </div>

          <!-- Attachments summary -->
          <div v-if="(attachments?.length ?? 0) > 0" class="space-y-1">
            <div v-for="att in attachments" :key="att.id" class="flex items-center justify-between gap-2 py-1">
              <div class="flex items-center gap-2 min-w-0">
                <img
                  v-if="isImage(att.path, att.contentType)"
                  :src="attFileUrl(att.path, att.contentType)"
                  class="size-6 rounded object-cover shrink-0"
                  alt=""
                />
                <UIcon v-else name="i-lucide-file" class="size-4 text-gray-400 shrink-0" />
                <span class="text-xs truncate">{{ fileName(att.path) }}</span>
                <span v-if="att.name && att.name !== fileName(att.path)" class="text-[10px] text-gray-400 shrink-0">{{
                  att.name
                }}</span>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-xs text-gray-400">{{ formatBytes(att.size ?? 0) }}</span>
                <UButton
                  :to="attFileUrl(att.path, att.contentType)"
                  target="_blank"
                  icon="i-lucide-external-link"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  label="Open"
                />
              </div>
            </div>
          </div>
        </div>
      </BlockCard>

      <!-- Links -->
      <BlockCard :class="blockColSpanClass" title="Links" icon="i-lucide-link">
        <EntityLinks
          v-if="testCase?.id"
          entity-type="test_case"
          :entity-id="testCase.id"
          :links="stableLinks ?? null"
        />
      </BlockCard>
    </div>
  </FoldableSummary>
</template>
