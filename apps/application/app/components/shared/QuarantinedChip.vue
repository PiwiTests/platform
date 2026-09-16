<script setup lang="ts">
/**
 * Marks a test that is currently quarantined — shown wherever a quarantined test
 * is listed (execution summary, cluster affected-tests list, run executions).
 * A quarantined test still runs and reports; it is only excluded from the CI
 * gate's verdict, which the tooltip says so the badge is not read as "skipped".
 */
withDefaults(defineProps<{ size?: 'xs' | 'sm' }>(), { size: 'xs' });
</script>

<template>
  <UBadge
    color="warning"
    variant="subtle"
    :size="size"
    class="gap-1 shrink-0"
    title="Quarantined — still runs and reports, but excluded from the CI gate's verdict"
  >
    <UIcon name="i-lucide-shield-alert" class="size-3" />
    Quarantined
  </UBadge>
</template>
