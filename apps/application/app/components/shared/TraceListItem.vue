<script setup lang="ts">
import type { TraceInfo } from '~~/types/api';

const props = withDefaults(
  defineProps<{
    trace: TraceInfo;
    showTime?: boolean;
  }>(),
  {
    showTime: true,
  },
);

const config = useRuntimeConfig();
const base = computed(() => (config.app?.baseURL ?? '/').replace(/\/$/, ''));

// Demo mode: the sample trace is a committed static asset. The trace viewer
// fetches through its own service worker (bypassing the demo's API-emulating
// one), so it must be pointed at the static URL, not /api/files/.
const isDemoStaticAsset = computed(() => !!config.public.demoMode && props.trace.filePath.startsWith('demo/'));

const name = computed(() => props.trace.filePath.split('/').pop() || props.trace.filePath);
const viewUrl = computed(() => getTraceViewerUrl(props.trace.filePath, config.app?.baseURL, isDemoStaticAsset.value));
const downloadUrl = computed(() =>
  isDemoStaticAsset.value
    ? `${base.value}/${props.trace.filePath}`
    : `${base.value}/api/files/${getFileApiPath(props.trace.filePath)}`,
);

// In the desktop shell `target="_blank"` is inert, so the anchors are overridden
// there: the viewer opens in a new app window (which keeps the access-token
// cookie) and the archive is saved through the shell. On web the anchors are
// left to do their normal thing (new tab / native download).
const { isDesktop, openWindow } = useDesktopWindow();
const { download } = useDesktopDownload();

function onView(event: MouseEvent) {
  if (!isDesktop) return;
  event.preventDefault();
  openWindow(viewUrl.value);
}
function onDownload(event: MouseEvent) {
  if (!isDesktop) return;
  event.preventDefault();
  download(downloadUrl.value, name.value, { binary: true });
}
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2 min-w-0">
      <UIcon name="i-lucide-file-archive" class="size-4 text-gray-400 shrink-0" />
      <span class="text-sm truncate">{{ name }}</span>
      <span v-if="trace.size" class="text-xs text-gray-400 shrink-0">{{ formatBytes(trace.size) }}</span>
      <span v-if="showTime" class="text-xs text-gray-400 shrink-0">{{ formatRelativeTime(trace.createdAt) }}</span>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      <UButton :to="viewUrl" target="_blank" icon="i-lucide-bug-play" size="xs" label="View trace" @click="onView" />
      <UButton
        :to="downloadUrl"
        target="_blank"
        icon="i-lucide-download"
        size="xs"
        color="neutral"
        variant="soft"
        label="Download"
        @click="onDownload"
      />
    </div>
  </div>
</template>
