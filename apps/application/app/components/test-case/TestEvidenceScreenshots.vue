<script setup lang="ts">
import type { AttachmentInfo } from '~~/types/api';
import { isImageFile } from '~/utils/text-format';

const props = defineProps<{
  attachments: AttachmentInfo[];
  /** Drop the bordered frame — render a plain heading row over the thumbnails. */
  embedded?: boolean;
}>();

const config = useRuntimeConfig();

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

const images = computed(() =>
  props.attachments
    .filter((att) => isImageFile(att.path, att.contentType))
    .map((att) => ({
      src: fileApiUrl(att.path, att.contentType, config.app?.baseURL),
      name: att.name || fileName(att.path),
    })),
);

const currentIndex = ref<number | null>(null);
</script>

<template>
  <TestEvidenceSection
    v-if="images.length > 0"
    icon="i-lucide-image"
    label="Screenshots"
    :count="images.length"
    :collapsible="false"
    :embedded="embedded"
  >
    <!-- The whole page, never a crop: one screenshot shows at reading size, several
         share a grid, each fitted into its frame with its name underneath. -->
    <div
      class="grid gap-3"
      :class="[images.length > 1 ? 'sm:grid-cols-2' : '', embedded ? '' : 'p-2 bg-gray-50 dark:bg-gray-900']"
    >
      <figure v-for="(img, idx) in images" :key="img.src" class="min-w-0 space-y-1">
        <ZoomableImage
          :src="img.src"
          :alt="img.name"
          :inline="images.length === 1"
          frame-class="rounded-md bg-elevated/40"
          :img-class="
            images.length === 1
              ? 'max-h-[28rem] w-auto max-w-full object-contain'
              : 'aspect-video w-full object-contain object-top'
          "
          @open="currentIndex = idx"
        />
        <figcaption class="truncate text-xs text-muted" :title="img.name">{{ img.name }}</figcaption>
      </figure>
    </div>
    <ScreenshotLightbox v-model="currentIndex" :images="images" />
  </TestEvidenceSection>
</template>
