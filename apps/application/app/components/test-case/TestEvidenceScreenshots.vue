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
    <div class="grid grid-cols-2 gap-2" :class="embedded ? '' : 'p-2 bg-gray-50 dark:bg-gray-900'">
      <ZoomableImage
        v-for="(img, idx) in images"
        :key="img.src"
        :src="img.src"
        :alt="img.name"
        frame-class="rounded"
        img-class="w-full h-28 object-cover object-top"
        @open="currentIndex = idx"
      >
        <p
          class="pointer-events-none absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white bg-black/50 truncate"
        >
          {{ img.name }}
        </p>
      </ZoomableImage>
    </div>
    <ScreenshotLightbox v-model="currentIndex" :images="images" />
  </TestEvidenceSection>
</template>
