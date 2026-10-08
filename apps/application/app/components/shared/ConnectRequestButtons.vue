<script setup lang="ts">
/**
 * Deny and Allow for a pending connection request, with the error of the last
 * answer. Allow is the page's one primary action; `allowDisabled` holds it
 * back (until the user confirms a code, or while the browser leaves).
 */
defineProps<{
  deciding: 'allow' | 'deny' | null;
  error: string;
  allowDisabled?: boolean;
  /** Why Allow is disabled, as its tooltip. */
  allowTitle?: string;
  denyDisabled?: boolean;
}>();

const emit = defineEmits<{ decide: [allow: boolean] }>();
</script>

<template>
  <UAlert v-if="error" color="error" variant="subtle" :title="error" />
  <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
    <UButton
      color="neutral"
      variant="outline"
      label="Deny"
      :loading="deciding === 'deny'"
      :disabled="deciding !== null || denyDisabled"
      class="justify-center"
      @click="emit('decide', false)"
    />
    <UButton
      color="primary"
      label="Allow"
      :title="allowTitle"
      :loading="deciding === 'allow'"
      :disabled="deciding !== null || allowDisabled"
      class="justify-center"
      @click="emit('decide', true)"
    />
  </div>
</template>
