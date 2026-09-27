<script setup lang="ts">
/**
 * One line of a setup check — "Signed in as Ada", "Not a Slack address" — with
 * a status icon and, under it, what to do about it. Used by the connection and
 * channel forms, where each step of a check reports on its own line.
 */
const props = defineProps<{
  state: 'ok' | 'warning' | 'error' | 'pending';
  /** The line itself; the default slot replaces it when it needs markup. */
  text?: string;
  /** What to do about a warning or an error. */
  hint?: string | null;
}>();

const ICONS = {
  ok: 'i-lucide-circle-check',
  warning: 'i-lucide-triangle-alert',
  error: 'i-lucide-circle-x',
  pending: 'i-lucide-loader-circle',
} as const;

const COLORS = {
  ok: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  pending: 'text-muted animate-spin',
} as const;

const icon = computed(() => ICONS[props.state]);
const color = computed(() => COLORS[props.state]);
</script>

<template>
  <div class="flex items-start gap-2 text-sm" :data-state="state">
    <UIcon :name="icon" class="mt-0.5 size-4 shrink-0" :class="color" />
    <div class="min-w-0 space-y-0.5">
      <p class="text-highlighted break-words">
        <slot>{{ text }}</slot>
      </p>
      <p v-if="hint" class="text-xs text-muted break-words">{{ hint }}</p>
    </div>
  </div>
</template>
