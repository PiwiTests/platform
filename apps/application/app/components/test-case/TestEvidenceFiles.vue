<script setup lang="ts">
/**
 * The execution's files under the Screen tab's views: its traces, and every
 * attachment that is neither a screenshot nor a video (those are views of the
 * page above). Renders nothing when there are none.
 */
import type { AttachmentInfo, TraceInfo } from '~~/types/api';
import { isImageFile, isVideoFile } from '~/utils/text-format';

const props = defineProps<{
  attachments: AttachmentInfo[];
  traces: TraceInfo[];
}>();

const config = useRuntimeConfig();

// Either list can arrive undefined for a case with no attachments or no traces.
const traces = computed(() => (Array.isArray(props.traces) ? props.traces : []));
const otherAttachments = computed(() =>
  (Array.isArray(props.attachments) ? props.attachments : []).filter(
    (a) => !isImageFile(a.path, a.contentType) && !isVideoFile(a.path, a.contentType),
  ),
);

function fileUrl(path: string, contentType?: string | null): string {
  return fileApiUrl(path, contentType, config.app?.baseURL);
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

// `target="_blank"` is inert in the desktop shell — open the attachment in a new
// app window (which keeps the access-token cookie so the guarded file route
// loads) instead. On web the anchor opens a new tab as usual.
const { isDesktop, openWindow } = useDesktopWindow();
function onOpenAttachment(event: MouseEvent, url: string) {
  if (!isDesktop) return;
  event.preventDefault();
  openWindow(url);
}
</script>

<template>
  <div v-if="traces.length || otherAttachments.length" class="space-y-4">
    <TestEvidenceTraces :traces="traces" embedded />

    <TestEvidenceSection
      v-if="otherAttachments.length"
      embedded
      icon="i-lucide-paperclip"
      label="Attachments"
      :count="otherAttachments.length"
      :collapsible="false"
    >
      <div class="divide-y divide-default">
        <div v-for="att in otherAttachments" :key="att.id" class="flex items-center justify-between gap-2 py-2">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-file" class="size-4 text-gray-400 shrink-0" />
            <span class="text-sm truncate">{{ fileName(att.path) }}</span>
            <span v-if="att.size" class="text-xs text-gray-400 shrink-0">{{ formatBytes(att.size) }}</span>
          </div>
          <UButton
            :to="fileUrl(att.path, att.contentType)"
            target="_blank"
            icon="i-lucide-external-link"
            size="xs"
            color="neutral"
            variant="outline"
            label="Open"
            @click="onOpenAttachment($event, fileUrl(att.path, att.contentType))"
          />
        </div>
      </div>
    </TestEvidenceSection>
  </div>
</template>
