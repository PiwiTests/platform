<script setup lang="ts">
import type { AttachmentInfo } from '~~/types/api'

defineProps<{
  attachments: AttachmentInfo[]
}>()

const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])
const videoExts = new Set(['.webm', '.mp4', '.ogg', '.mov'])

function isImage(path: string): boolean {
  return imageExts.has(path.toLowerCase().split('.').pop()!)
}

function isVideo(path: string): boolean {
  return videoExts.has(path.toLowerCase().split('.').pop()!)
}

function fileUrl(path: string): string {
  return `/api/files/${getFileApiPath(path)}`
}

function fileName(path: string): string {
  return path.split('/').pop() || path
}

function formatSize(size: number | null): string {
  if (size === null || size === undefined) return ''
  return formatBytes(size)
}
</script>

<template>
  <UCard v-if="attachments.length > 0">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-paperclip" class="w-5 h-5 text-primary" />
        <h3 class="text-lg font-medium">
          Attachments ({{ attachments.length }})
        </h3>
      </div>
    </template>

    <div class="space-y-3">
      <div
        v-for="att in attachments"
        :key="att.id"
        class="rounded-lg border overflow-hidden"
      >
        <div class="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon
              :name="isImage(att.path) ? 'i-lucide-image' : isVideo(att.path) ? 'i-lucide-video' : 'i-lucide-file'"
              class="size-4 text-gray-400 shrink-0"
            />
            <span class="text-sm font-medium truncate">{{ att.name || fileName(att.path) }}</span>
            <span class="text-xs text-gray-400">{{ formatSize(att.size) }}</span>
          </div>
          <a
            :href="fileUrl(att.path)"
            target="_blank"
            class="text-primary hover:underline text-xs shrink-0"
          >Open</a>
        </div>

        <div v-if="isImage(att.path)" class="bg-gray-100 dark:bg-gray-900">
          <a :href="fileUrl(att.path)" target="_blank">
            <img
              :src="fileUrl(att.path)"
              :alt="att.name || 'Screenshot'"
              class="max-w-full max-h-96 object-contain mx-auto cursor-pointer hover:opacity-90 transition-opacity"
              loading="lazy"
            >
          </a>
        </div>

        <div v-else-if="isVideo(att.path)" class="bg-black">
          <video
            :src="fileUrl(att.path)"
            controls
            preload="metadata"
            class="max-w-full max-h-96 mx-auto"
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </div>
  </UCard>
</template>
