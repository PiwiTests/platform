<script setup lang="ts">
import type { AttachmentInfo } from '~~/types/api';

const props = defineProps<{
  attachments: AttachmentInfo[];
}>();

const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const imageMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp']);

function getExt(path: string): string {
  return '.' + (path.toLowerCase().split('.').pop() || '');
}

function isImage(path: string, contentType?: string | null): boolean {
  if (imageExts.has(getExt(path))) return true;
  if (contentType && imageMimes.has(contentType.toLowerCase())) return true;
  return false;
}

function fileUrl(path: string, contentType?: string | null): string {
  let url = `/api/files/${getFileApiPath(path)}`;
  if (contentType && getExt(path) === '.') url += `?contentType=${encodeURIComponent(contentType)}`;
  return url;
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

const images = computed(() =>
  props.attachments
    .filter((att) => isImage(att.path, att.contentType))
    .map((att) => ({
      src: fileUrl(att.path, att.contentType),
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
  >
    <div class="grid grid-cols-2 gap-2 p-2 bg-gray-50 dark:bg-gray-900">
      <div
        v-for="(img, idx) in images"
        :key="img.src"
        class="relative group cursor-pointer rounded overflow-hidden border border-default"
        @click="currentIndex = idx"
      >
        <img
          :src="img.src"
          :alt="img.name"
          class="w-full h-28 object-cover object-top transition-opacity group-hover:opacity-80"
          loading="lazy"
        />
        <div
          class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30"
        >
          <UIcon name="i-lucide-zoom-in" class="size-5 text-white" />
        </div>
        <p class="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white bg-black/50 truncate">
          {{ img.name }}
        </p>
      </div>
    </div>
    <ScreenshotLightbox v-model="currentIndex" :images="images" />
  </TestEvidenceSection>
</template>
