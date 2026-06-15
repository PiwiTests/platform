<script setup lang="ts">
import type { AttachmentInfo } from '~~/types/api';

const props = defineProps<{
  attachments: AttachmentInfo[];
}>();

const currentImageIndex = ref<number | null>(null);

const imageAttachments = computed(() =>
  props.attachments
    .filter((att) => isImage(att.path, att.contentType))
    .map((att) => ({
      src: fileUrl(att.path, att.contentType),
      name: att.name || fileName(att.path),
    })),
);

function openLightbox(index: number) {
  currentImageIndex.value = index;
}

const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const videoExts = new Set(['.webm', '.mp4', '.ogg', '.mov']);
const markdownExts = new Set(['.md', '.mdx', '.markdown']);
const imageMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp']);
const videoMimes = new Set(['video/webm', 'video/mp4', 'video/ogg', 'video/quicktime']);
const markdownMimes = new Set(['text/markdown', 'text/x-markdown']);

function getExt(path: string): string {
  return path.toLowerCase().split('.').pop() || '';
}

function isImage(path: string, contentType?: string | null): boolean {
  if (imageExts.has(getExt(path))) return true;
  if (contentType && imageMimes.has(contentType.toLowerCase())) return true;
  return false;
}

function isVideo(path: string, contentType?: string | null): boolean {
  if (videoExts.has(getExt(path))) return true;
  if (contentType && videoMimes.has(contentType.toLowerCase())) return true;
  return false;
}

function isMarkdown(path: string, contentType?: string | null): boolean {
  if (markdownExts.has(getExt(path))) return true;
  if (contentType && markdownMimes.has(contentType.toLowerCase())) return true;
  return false;
}

function fileUrl(path: string, contentType?: string | null): string {
  let url = `/api/files/${getFileApiPath(path)}`;
  if (contentType && getExt(path) === '') {
    url += `?contentType=${encodeURIComponent(contentType)}`;
  }
  return url;
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function formatSize(size: number | null): string {
  if (size === null || size === undefined) return '';
  return formatBytes(size);
}

const markdownContent = ref<Record<number, string | null>>({});
const markdownError = ref<Record<number, string | null>>({});
const markdownLoading = ref<Record<number, boolean>>({});
const expandedPreviews = ref<Set<number>>(new Set());

async function loadMarkdown(att: AttachmentInfo) {
  if (markdownContent.value[att.id] !== undefined) return;
  if (markdownLoading.value[att.id]) return;

  markdownLoading.value[att.id] = true;
  markdownError.value[att.id] = null;

  try {
    const response = await $fetch<string>(fileUrl(att.path, att.contentType), {
      responseType: 'text',
    });
    markdownContent.value[att.id] = response;
  } catch {
    markdownError.value[att.id] = 'Failed to load preview';
  } finally {
    markdownLoading.value[att.id] = false;
  }
}

function togglePreview(attId: number, att: AttachmentInfo) {
  const newSet = new Set(expandedPreviews.value);
  if (newSet.has(attId)) {
    newSet.delete(attId);
  } else {
    newSet.add(attId);
    loadMarkdown(att);
  }
  expandedPreviews.value = newSet;
}
</script>

<template>
  <SectionCard v-if="attachments.length > 0" icon="i-lucide-paperclip" title="Attachments" :count="attachments.length">
    <div class="space-y-3">
      <div v-for="att in attachments" :key="att.id" class="rounded-lg border overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon
              :name="
                isImage(att.path, att.contentType)
                  ? 'i-lucide-image'
                  : isVideo(att.path, att.contentType)
                    ? 'i-lucide-video'
                    : isMarkdown(att.path, att.contentType)
                      ? 'i-lucide-file-text'
                      : 'i-lucide-file'
              "
              class="size-4 text-gray-400 shrink-0"
            />
            <span class="text-sm font-medium truncate">{{ fileName(att.path) }}</span>
            <span v-if="att.name && att.name !== fileName(att.path)" class="text-xs text-gray-400 shrink-0">{{
              att.name
            }}</span>
            <span class="text-xs text-gray-400">{{ formatSize(att.size) }}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <UButton
              v-if="isMarkdown(att.path, att.contentType)"
              size="xs"
              color="neutral"
              variant="soft"
              @click="togglePreview(att.id, att)"
            >
              {{ expandedPreviews.has(att.id) ? 'Hide preview' : 'Preview' }}
            </UButton>
            <a
              :href="fileUrl(att.path, att.contentType)"
              target="_blank"
              class="text-primary hover:underline text-xs shrink-0"
              >Open</a
            >
          </div>
        </div>

        <div v-if="isImage(att.path, att.contentType)" class="bg-gray-100 dark:bg-gray-900">
          <img
            :src="fileUrl(att.path, att.contentType)"
            :alt="att.name || 'Screenshot'"
            class="max-w-full max-h-96 object-contain mx-auto cursor-pointer hover:opacity-90 transition-opacity"
            loading="lazy"
            @click="openLightbox(imageAttachments.findIndex((ia) => ia.src === fileUrl(att.path, att.contentType)))"
          />
        </div>

        <div v-else-if="isVideo(att.path, att.contentType)" class="bg-black">
          <video
            :src="fileUrl(att.path, att.contentType)"
            controls
            preload="metadata"
            class="max-w-full max-h-96 mx-auto"
          >
            Your browser does not support the video tag.
          </video>
        </div>

        <div
          v-else-if="isMarkdown(att.path, att.contentType) && expandedPreviews.has(att.id)"
          class="bg-gray-50 dark:bg-gray-900"
        >
          <div v-if="markdownLoading[att.id]" class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-gray-400" />
          </div>
          <div v-else-if="markdownError[att.id]" class="p-4 text-red-500 text-sm">
            {{ markdownError[att.id] }}
          </div>
          <div v-else-if="markdownContent[att.id]" class="p-4 overflow-auto max-h-96">
            <pre class="text-sm whitespace-pre-wrap font-sans leading-relaxed">{{ markdownContent[att.id] }}</pre>
          </div>
        </div>
      </div>
    </div>

    <ScreenshotLightbox v-model="currentImageIndex" :images="imageAttachments" />
  </SectionCard>
</template>
