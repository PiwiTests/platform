<script setup lang="ts">
/**
 * Desktop shell only: import archives the OS handed to the app (drag & drop,
 * "Open with", dock drops). Each file goes to the desktop-only local import
 * route, which reads it from disk server-side — same semantics as the import
 * page: idempotent, silent (no notifications or regression signals).
 */
interface ProjectMenuItem {
  id: number;
  name: string;
  label: string | null;
}

interface ImportOutcome {
  status: 'importing' | 'imported' | 'duplicate' | 'error';
  testRunId?: number;
  message?: string;
}

const { files, open, removeFile, clear } = useDesktopImportQueue();

const {
  data: projects,
  execute: loadProjects,
  status: projectsStatus,
} = useFetch('/api/projects/menu', {
  immediate: false,
  default: () => [] as ProjectMenuItem[],
  transform: (r: { items: ProjectMenuItem[] }) => r.items,
});

watch(open, (value) => {
  if (value && projects.value.length === 0) void loadProjects();
});

const projectName = ref<string | undefined>();
const label = ref('');
const combine = ref(true);
const importing = ref(false);
const outcomes = reactive<Record<string, ImportOutcome>>({});

const projectItems = computed(() => projects.value.map((p) => ({ label: p.label || p.name, value: p.name })));

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function randomGroup(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function importAll() {
  if (!projectName.value || importing.value || files.value.length === 0) return;
  importing.value = true;
  // One shared group per batch gathers several dropped traces into one run;
  // the server ignores it for blob reports.
  const group = combine.value && files.value.length > 1 ? randomGroup() : undefined;
  try {
    for (const path of [...files.value]) {
      const current = outcomes[path]?.status;
      if (current === 'imported' || current === 'duplicate') continue;
      outcomes[path] = { status: 'importing' };
      try {
        const result = await $fetch<{ status: 'imported' | 'duplicate'; runId: number }>('/api/desktop/import-local', {
          method: 'POST',
          body: {
            path,
            projectName: projectName.value,
            label: label.value.trim() || undefined,
            importGroup: group,
          },
        });
        outcomes[path] = { status: result.status, testRunId: result.runId };
      } catch (error) {
        outcomes[path] = { status: 'error', message: errorMessage(error) };
      }
    }
  } finally {
    importing.value = false;
  }
}

const allDone = computed(
  () =>
    files.value.length > 0 &&
    files.value.every((p) => outcomes[p]?.status === 'imported' || outcomes[p]?.status === 'duplicate'),
);

// A fully imported batch clears out when the dialog closes, so the next drop
// starts fresh; a partial one is kept for another attempt.
watch(open, (value) => {
  if (!value && allDone.value) {
    clear();
    for (const key of Object.keys(outcomes)) delete outcomes[key];
  }
});

function outcomeBadge(path: string): { label: string; color: 'info' | 'success' | 'neutral' | 'error' } | null {
  const outcome = outcomes[path];
  if (!outcome) return null;
  switch (outcome.status) {
    case 'importing':
      return { label: 'Importing…', color: 'info' };
    case 'imported':
      return { label: 'Imported', color: 'success' };
    case 'duplicate':
      return { label: 'Already imported', color: 'neutral' };
    case 'error':
      return { label: 'Failed', color: 'error' };
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-xl' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-file-input" class="size-5 text-primary" />
        <h2 class="text-base font-semibold">Import archives</h2>
        <UBadge color="neutral" variant="subtle" size="sm">{{ files.length }}</UBadge>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Playwright blob reports become complete runs; bare traces become single executions. Re-importing the same
          archive is a no-op, and imports never trigger notifications or regression signals.
        </p>

        <div class="space-y-2">
          <div v-for="path in files" :key="path" class="flex items-center gap-2 rounded-md border border-default p-2">
            <UIcon name="i-lucide-file-archive" class="size-4 text-gray-400 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-sm truncate">{{ fileName(path) }}</p>
              <p class="text-xs text-muted truncate">{{ path }}</p>
              <p v-if="outcomes[path]?.message" class="text-xs text-error">{{ outcomes[path]?.message }}</p>
            </div>
            <UBadge v-if="outcomeBadge(path)" :color="outcomeBadge(path)!.color" variant="subtle" size="sm">
              {{ outcomeBadge(path)!.label }}
            </UBadge>
            <UButton
              v-if="outcomes[path]?.status === 'imported' || outcomes[path]?.status === 'duplicate'"
              :to="`/test-runs/${outcomes[path]?.testRunId}`"
              size="xs"
              color="neutral"
              variant="soft"
              @click="open = false"
            >
              View run
            </UButton>
            <UButton
              v-else
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="importing"
              aria-label="Remove from import"
              @click="removeFile(path)"
            />
          </div>
          <EmptyState v-if="files.length === 0" icon="i-lucide-file-x" text="Nothing to import" />
        </div>

        <UFormField label="Import into project" name="projectName">
          <USelectMenu
            v-model="projectName"
            :items="projectItems"
            value-key="value"
            :loading="projectsStatus === 'pending'"
            placeholder="Select a project…"
            class="w-full"
            :disabled="importing"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Label" name="label" description="Optional run label.">
            <UInput v-model="label" :disabled="importing" class="w-full" />
          </UFormField>
          <UFormField
            v-if="files.length > 1"
            label="Combine traces"
            name="combine"
            description="Gather dropped traces into one run."
          >
            <USwitch v-model="combine" :disabled="importing" />
          </UFormField>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-end w-full gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">Close</UButton>
        <UButton
          icon="i-lucide-file-input"
          :loading="importing"
          :disabled="!projectName || files.length === 0 || allDone"
          @click="importAll()"
        >
          Import
        </UButton>
      </div>
    </template>
  </UModal>
</template>
