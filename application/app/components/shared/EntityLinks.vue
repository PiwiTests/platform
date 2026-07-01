<script setup lang="ts">
import type { EntityLinkInfo } from '~~/types/api';
import { detectProvider, getProviderIcon } from '#shared/link-detect';

const props = defineProps<{
  entityType: 'test_run' | 'test_runs_case' | 'test_case';
  entityId: number;
  links?: EntityLinkInfo[] | null;
}>();

const emit = defineEmits<{
  updated: [];
}>();

const { copy } = useCopy();

const localLinks = ref<EntityLinkInfo[]>(props.links ?? []);
const newUrl = ref('');
const addLinkOpen = ref(false);
const adding = ref(false);

const previewProvider = computed(() => {
  try {
    return newUrl.value ? detectProvider(newUrl.value) : null;
  } catch {
    return null;
  }
});

const previewIcon = computed(() => {
  return previewProvider.value ? getProviderIcon(previewProvider.value as any) : null;
});

async function loadLinks() {
  const data = await $fetch<{ links: EntityLinkInfo[] }>('/api/links', {
    params: { entityType: props.entityType, entityId: props.entityId },
  });
  localLinks.value = data.links;
}

async function addLink() {
  if (!newUrl.value || adding.value) return;
  adding.value = true;
  try {
    const data = await $fetch<{ link: EntityLinkInfo }>('/api/links', {
      method: 'POST',
      body: { entityType: props.entityType, entityId: props.entityId, url: newUrl.value },
    });
    localLinks.value.push(data.link);
    newUrl.value = '';
    addLinkOpen.value = false;
    emit('updated');
  } catch (e: any) {
    copy(e?.data?.message || 'Failed to add link', { toast: true });
  } finally {
    adding.value = false;
  }
}

async function removeLink(id: number) {
  try {
    await $fetch(`/api/links/${id}`, { method: 'DELETE' });
    localLinks.value = localLinks.value.filter((l) => l.id !== id);
    emit('updated');
  } catch {
    copy('Failed to remove link', { toast: true });
  }
}

watch(
  () => [props.entityType, props.entityId] as const,
  () => {
    if (props.links) {
      localLinks.value = props.links;
    } else {
      loadLinks();
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <LinkChip v-for="link in localLinks" :key="link.id" :link="link" removable @remove="removeLink" />

    <UPopover v-model:open="addLinkOpen">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-plus"
        class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        title="Add link"
      />

      <template #content>
        <form class="p-3 space-y-3 min-w-72" @submit.prevent="addLink">
          <p class="text-sm font-medium">Add link</p>

          <div class="relative">
            <UInput v-model="newUrl" placeholder="https://..." size="sm" class="w-full" autofocus />
            <UIcon
              v-if="previewIcon"
              :name="previewIcon!"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            />
          </div>

          <div class="flex justify-end gap-2">
            <UButton size="xs" variant="ghost" color="neutral" @click="addLinkOpen = false"> Cancel </UButton>
            <UButton size="xs" color="primary" type="submit" :loading="adding" :disabled="!newUrl.trim()">
              Add
            </UButton>
          </div>
        </form>
      </template>
    </UPopover>
  </div>
</template>
