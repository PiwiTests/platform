<script setup lang="ts">
import type { AttachmentInfo } from '~~/types/api';
import { isVideoFile } from '~/utils/text-format';

const props = defineProps<{
  attachments: AttachmentInfo[];
  /** Drop the bordered frame — render a plain heading row over the players. */
  embedded?: boolean;
}>();

const config = useRuntimeConfig();

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

const videos = computed(() =>
  props.attachments
    .filter((att) => isVideoFile(att.path, att.contentType))
    .map((att) => ({
      src: fileApiUrl(att.path, att.contentType, config.app?.baseURL),
      name: att.name || fileName(att.path),
    })),
);
</script>

<template>
  <TestEvidenceSection
    v-if="videos.length > 0"
    icon="i-lucide-video"
    label="Videos"
    :count="videos.length"
    :collapsible="false"
    :embedded="embedded"
  >
    <div class="space-y-2" :class="embedded ? '' : 'p-2 bg-gray-50 dark:bg-gray-900'">
      <VideoPlayer v-for="video in videos" :key="video.src" :src="video.src" :label="video.name" />
    </div>
  </TestEvidenceSection>
</template>
