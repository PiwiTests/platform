<script setup lang="ts">
/** The per-group actions of Settings → Groups, shared by the table and the phone card list. */
defineProps<{ name: string }>();

const emit = defineEmits<{ edit: []; delete: [] }>();
</script>

<template>
  <div class="flex items-center justify-end gap-1">
    <UButton
      icon="i-lucide-pencil"
      color="neutral"
      variant="ghost"
      size="sm"
      title="Edit the group and its members"
      :aria-label="`Edit ${name}`"
      @click="emit('edit')"
    />
    <UButton
      icon="i-lucide-trash-2"
      color="error"
      variant="ghost"
      size="sm"
      title="Delete group"
      :aria-label="`Delete ${name}`"
      @click="emit('delete')"
    />
  </div>
</template>
