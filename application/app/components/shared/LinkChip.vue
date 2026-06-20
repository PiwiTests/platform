<script setup lang="ts">
import type { EntityLinkInfo } from '~~/types/api';
import { getProviderIcon } from '~~/shared/link-detect';

const props = defineProps<{
  link: EntityLinkInfo;
  removable?: boolean;
}>();

const emit = defineEmits<{
  remove: [id: number];
}>();

const displayLabel = computed(() => {
  return props.link.title || props.link.key || props.link.url.replace(/^https?:\/\//, '').slice(0, 50);
});

const providerIcon = computed(() => getProviderIcon(props.link.provider as any));
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 group hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
  >
    <span :class="[providerIcon, 'w-3.5 h-3.5 shrink-0']" />

    <span v-if="link.key" class="font-mono text-primary font-medium">{{ link.key }}</span>

    <span class="max-w-48 truncate" :title="link.title || link.url">{{ displayLabel }}</span>

    <UBadge v-if="link.statusText" :color="(link.statusColor as any) || 'neutral'" variant="subtle" size="xs">
      {{ link.statusText }}
    </UBadge>

    <UButton
      :to="link.url"
      target="_blank"
      size="xs"
      variant="ghost"
      color="neutral"
      icon="i-lucide-external-link"
      class="opacity-0 group-hover:opacity-100 transition-opacity -my-1"
    />

    <UButton
      v-if="removable"
      size="xs"
      variant="ghost"
      color="error"
      icon="i-lucide-x"
      class="opacity-0 group-hover:opacity-100 transition-opacity -my-1"
      @click="emit('remove', link.id)"
    />
  </span>
</template>
