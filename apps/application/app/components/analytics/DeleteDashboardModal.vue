<script setup lang="ts">
/** Confirm deleting a saved dashboard, naming the report schedules that render it: they stop until pointed elsewhere. */
defineProps<{ dashboard: { name: string; schedules: Array<{ id: number; name: string }> } | null }>();
const emit = defineEmits<{ confirm: [] }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <UModal v-model:open="open" :title="`Delete ${dashboard?.name ?? 'this dashboard'}?`">
    <template #body>
      <div class="space-y-2 text-sm text-highlighted" data-testid="delete-dashboard">
        <p>The dashboard is removed for everyone who can open it.</p>
        <template v-if="dashboard && dashboard.schedules.length > 0">
          <p>
            {{
              dashboard.schedules.length === 1 ? 'This report schedule renders it' : 'These report schedules render it'
            }}
            and will stop until their owner picks another dashboard:
          </p>
          <ul class="list-disc pl-5">
            <li v-for="s in dashboard.schedules" :key="s.id">{{ s.name }}</li>
          </ul>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton color="error" label="Delete" data-testid="delete-dashboard-confirm" @click="emit('confirm')" />
      </div>
    </template>
  </UModal>
</template>
