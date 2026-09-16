<script setup lang="ts">
/**
 * A git branch name, always with the branch icon in front so a branch reads as
 * a branch wherever it appears — a header, a table cell, a sentence, a select.
 * Renders "no branch" (muted) when the run has none. With `copyable`, the name
 * is a button that copies it to the clipboard (skip it inside another
 * clickable, such as a table row or a select option, to avoid nesting).
 */
const props = defineProps<{
  name: string | null | undefined;
  /** Inherit the surrounding text color instead of the default muted icon. */
  inherit?: boolean;
  /** Make the name click-to-copy. */
  copyable?: boolean;
}>();

const { copy, copied } = useCopy();
</script>

<template>
  <span
    class="inline-flex items-center gap-1 align-middle min-w-0 max-w-full"
    :class="!name && 'text-muted'"
    :title="name ?? undefined"
  >
    <UIcon
      :name="copied ? 'i-lucide-check' : 'i-lucide-git-branch'"
      class="size-3 shrink-0"
      :class="copied ? 'text-success' : inherit ? '' : 'text-muted'"
    />
    <button
      v-if="name && copyable"
      type="button"
      class="truncate text-left hover:underline decoration-dotted underline-offset-2 cursor-pointer"
      :title="`Copy ${name}`"
      @click.stop.prevent="copy(name, { toast: `Copied ${name}` })"
    >
      {{ name }}
    </button>
    <span v-else class="truncate">{{ name ?? 'no branch' }}</span>
  </span>
</template>
