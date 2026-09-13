<script setup lang="ts">
/**
 * Desktop shell only: the project's linked local folder, managed from the
 * project edit page alongside the other project settings. Changes apply
 * immediately — the link lives in the shell's own store on this machine, not
 * in the server database. Renders nothing without the IPC bridge.
 */
import type { DesktopFolderInspection } from '~/composables/useDesktopFolderInspect';

const props = defineProps<{ projectId: string | number; projectName?: string | null }>();

const { available, link, busy, pickAndLink, unlink } = useDesktopProjectLink(() => props.projectId);
const { propose: proposePrevRuns } = useDesktopImportPrevRuns();

const inspection = ref<DesktopFolderInspection | null>(null);

watch(
  () => link.value?.path,
  async (path) => {
    inspection.value = path && link.value?.exists ? await inspectDesktopFolder(path) : null;
  },
  { immediate: true },
);

/** Link (or re-link) the folder, then offer to import the runs already in it. */
async function chooseAndPropose() {
  const linked = await pickAndLink();
  if (linked) void proposePrevRuns(props.projectName, link.value?.path);
}
</script>

<template>
  <SectionCard
    v-if="available"
    id="local-folder"
    icon="i-lucide-folder-symlink"
    title="Local folder"
    help="project.local-folder"
  >
    <template #subtitle>
      The checkout of this project on this machine — used to run tests locally and open files in your IDE.
    </template>
    <template #actions>
      <UBadge v-if="link && !link.exists" color="warning" variant="subtle" size="sm">missing</UBadge>
      <UBadge v-else-if="inspection && isFolderPiwiReady(inspection)" color="success" variant="subtle" size="sm">
        ready
      </UBadge>
      <UBadge v-else-if="inspection" color="warning" variant="subtle" size="sm">needs setup</UBadge>
    </template>

    <div v-if="link" class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0 text-sm">
          <UIcon
            :name="link.exists ? 'i-lucide-folder-check' : 'i-lucide-folder-x'"
            class="size-4 shrink-0"
            :class="link.exists ? 'text-success' : 'text-warning'"
          />
          <code class="text-xs break-all">{{ link.path }}</code>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-folder-search"
            :loading="busy"
            @click="chooseAndPropose"
          >
            Change
          </UButton>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-unlink" :disabled="busy" @click="unlink">
            Unlink
          </UButton>
        </div>
      </div>

      <p v-if="!link.exists" class="text-sm text-warning">
        The folder is gone from this machine — pick the checkout again.
      </p>

      <DesktopFolderChecklist v-if="inspection" :inspection="inspection" />
    </div>

    <div v-else class="flex items-center justify-between gap-3">
      <p class="text-sm text-muted">No folder linked on this machine yet.</p>
      <UButton size="xs" icon="i-lucide-folder-plus" :loading="busy" @click="chooseAndPropose">Choose folder…</UButton>
    </div>
  </SectionCard>
</template>
