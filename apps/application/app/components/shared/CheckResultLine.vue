<script setup lang="ts">
/**
 * One line of a setup check — "Signed in as Ada", "Not a Slack address" — with
 * a status icon and, under it, what to do about it. Used by the connection and
 * channel forms, where each step of a check reports on its own line, and by
 * long operations that list their steps as they go (the project deletion).
 */
const props = defineProps<{
  /** `waiting` is a step that has not started yet; `pending` one that is running. */
  state: 'ok' | 'warning' | 'error' | 'pending' | 'waiting';
  /** The line itself; the default slot replaces it when it needs markup. */
  text?: string;
  /** What to do about a warning or an error, or where a running step stands. */
  hint?: string | null;
}>();

const ICONS = {
  ok: 'i-lucide-circle-check',
  warning: 'i-lucide-triangle-alert',
  error: 'i-lucide-circle-x',
  pending: 'i-lucide-loader-circle',
  waiting: 'i-lucide-circle-dashed',
} as const;

const COLORS = {
  ok: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  pending: 'text-muted animate-spin',
  waiting: 'text-muted',
} as const;

const icon = computed(() => ICONS[props.state]);
const color = computed(() => COLORS[props.state]);
</script>

<template>
  <div class="flex items-start gap-2 text-sm" :data-state="state">
    <UIcon :name="icon" class="mt-0.5 size-4 shrink-0" :class="color" />
    <div class="min-w-0 space-y-0.5">
      <p class="break-words" :class="state === 'waiting' ? 'text-muted' : 'text-highlighted'">
        <slot>{{ text }}</slot>
      </p>
      <p v-if="hint" class="text-xs text-muted break-words">{{ hint }}</p>
    </div>
  </div>
</template>
