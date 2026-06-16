<script setup lang="ts">
import { errorMessage } from '~/utils';

interface AffectedTestCase {
  testCaseId: number;
  title: string;
  filePath: string;
  runCount: number;
  recentTestRunsCaseId: number;
}

const props = defineProps<{
  open: boolean;
  clusterId: number;
  affectedTestCases: AffectedTestCase[];
}>();

const emit = defineEmits<{
  'update:open': [boolean];
  extracted: [];
}>();

const toast = useToast();

const selectedIds = ref<Set<number>>(new Set());
const triageNote = ref('');
const extracting = ref(false);
const error = ref<string | null>(null);

function selectAll() {
  selectedIds.value = new Set(props.affectedTestCases.map((t) => t.testCaseId));
}

function deselectAll() {
  selectedIds.value = new Set();
}

function toggle(id: number) {
  const s = new Set(selectedIds.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  selectedIds.value = s;
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      deselectAll();
      triageNote.value = '';
      error.value = null;
    }
  },
);

const selectedCount = computed(() => selectedIds.value.size);

async function extract() {
  if (selectedCount.value === 0) return;
  extracting.value = true;
  error.value = null;
  try {
    await $fetch(`/api/failure-clusters/${props.clusterId}/extract-cases`, {
      method: 'POST',
      body: {
        testCaseIds: [...selectedIds.value],
        triageNote: triageNote.value.trim() || undefined,
      },
    });
    toast.add({
      title: `Extracted ${selectedCount.value} test ${selectedCount.value === 1 ? 'case' : 'cases'}`,
      color: 'success',
    });
    emit('extracted');
    emit('update:open', false);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    extracting.value = false;
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Extract test cases"
    :ui="{ content: 'max-w-4xl', body: 'p-0 flex flex-col overflow-hidden' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-col h-[60vh]">
        <!-- Select all / deselect all toolbar -->
        <div class="flex items-center gap-3 px-4 py-2.5 border-b border-default text-sm shrink-0">
          <button class="text-xs font-medium text-primary hover:underline" @click="selectAll">Select all</button>
          <span class="text-gray-300 dark:text-gray-600">·</span>
          <button class="text-xs font-medium text-primary hover:underline" @click="deselectAll">Deselect all</button>
          <span v-if="selectedCount > 0" class="ml-auto text-xs text-gray-500"> {{ selectedCount }} selected </span>
        </div>

        <!-- Scrollable table -->
        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-default">
              <tr>
                <th class="w-10 px-4 py-2.5"></th>
                <th class="text-left px-2 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Test</th>
                <th
                  class="text-left px-2 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell"
                >
                  File
                </th>
                <th class="text-right px-2 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide w-20">
                  Occurrences
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="tc in affectedTestCases"
                :key="tc.testCaseId"
                class="border-b border-default/50 hover:bg-elevated transition-colors cursor-pointer"
                @click="toggle(tc.testCaseId)"
              >
                <td class="px-4 py-2.5">
                  <input
                    type="checkbox"
                    :checked="selectedIds.has(tc.testCaseId)"
                    class="shrink-0 cursor-pointer accent-primary"
                    @click.stop
                    @change="toggle(tc.testCaseId)"
                  />
                </td>
                <td class="px-2 py-2.5 min-w-0">
                  <p class="truncate font-medium text-gray-800 dark:text-gray-200 max-w-[24rem]">
                    {{ tc.title }}
                  </p>
                  <NuxtLink
                    :to="`/test-cases/${tc.testCaseId}`"
                    class="text-[10px] text-primary hover:underline mt-0.5 inline-block"
                    @click.stop
                  >
                    View details
                  </NuxtLink>
                </td>
                <td class="px-2 py-2.5 text-gray-500 text-xs truncate max-w-[16rem] hidden sm:table-cell">
                  {{ tc.filePath }}
                </td>
                <td class="px-2 py-2.5 text-right text-gray-500 text-xs">
                  {{ tc.runCount }}
                </td>
              </tr>
              <tr v-if="affectedTestCases.length === 0">
                <td colspan="4" class="px-4 py-8 text-center text-gray-400 text-sm">No test cases in this cluster.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Triage note -->
        <div class="shrink-0 border-t border-default px-4 py-3 space-y-1.5">
          <label class="text-xs font-medium text-gray-500 uppercase tracking-wide">Triage note (optional)</label>
          <UTextarea
            v-model="triageNote"
            placeholder="Add a note explaining why these tests were extracted…"
            :rows="2"
            class="text-sm w-full"
          />
        </div>

        <!-- Error -->
        <p v-if="error" class="shrink-0 px-4 pb-3 flex items-center gap-1.5 text-xs text-red-500">
          <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
          {{ error }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center gap-3 w-full">
        <div class="flex-1" />
        <UButton color="neutral" variant="ghost" :disabled="extracting" @click="emit('update:open', false)">
          Cancel
        </UButton>
        <UButton color="warning" :disabled="selectedCount === 0" :loading="extracting" @click="extract">
          Extract{{ selectedCount > 0 ? ` ${selectedCount}` : '' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
