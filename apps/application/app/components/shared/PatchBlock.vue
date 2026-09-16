<script setup lang="ts">
/**
 * A suggested patch, rendered once: the `patch` label with a validation badge,
 * the download / git apply / copy actions, the diff itself, and — when the
 * patch could not be applied — the validator's first error line. Used wherever
 * a diagnosis or a fix plan surfaces its `.patch`.
 */
import type { PatchValidation } from '#shared/patch';

const props = defineProps<{
  patch: string;
  validation?: PatchValidation | null;
  /** File stem for the downloaded `.patch` (without extension). */
  downloadName?: string;
}>();

const { copy, copied, copyGitApply: copyGitApplyPatch, downloadPatch: downloadPatchFile } = usePatchActions();

const badge = computed<{
  color: 'success' | 'warning' | 'error' | 'neutral';
  icon: string;
  label: string;
  title: string;
} | null>(() => {
  const v = props.validation;
  if (!v) return null;
  switch (v.status) {
    case 'applies':
      return {
        color: 'success',
        icon: 'i-lucide-badge-check',
        label: 'Applies cleanly',
        title: 'Verified against the real file at the failing commit',
      };
    case 'applies-with-offset':
      return {
        color: 'warning',
        icon: 'i-lucide-badge-check',
        label: 'Applies with offset',
        title: 'Context matched at a shifted line — apply should still succeed',
      };
    case 'stale-file':
      return {
        color: 'error',
        icon: 'i-lucide-badge-alert',
        label: 'Does not apply',
        title: v.errors.join('\n') || 'The file changed since — patch context did not match',
      };
    case 'invalid':
      return {
        color: 'error',
        icon: 'i-lucide-badge-alert',
        label: 'Invalid diff',
        title: v.errors.join('\n') || 'Could not parse the patch as a unified diff',
      };
    default:
      return {
        color: 'neutral',
        icon: 'i-lucide-badge-help',
        label: 'Unverified',
        title: 'The source file was not in context, so the patch could not be validated',
      };
  }
});

const errorLine = computed(() =>
  props.validation && (props.validation.status === 'stale-file' || props.validation.status === 'invalid')
    ? props.validation.errors[0] || 'This patch could not be verified against the source.'
    : null,
);

function copyGitApply() {
  copyGitApplyPatch(props.patch);
}

function downloadPatch() {
  downloadPatchFile(props.patch, props.downloadName || 'piwi-fix');
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <div class="flex items-center gap-1.5">
        <span class="text-xs text-gray-500 font-mono">patch</span>
        <UBadge v-if="badge" :color="badge.color" variant="subtle" size="sm" :icon="badge.icon" :title="badge.title">
          {{ badge.label }}
        </UBadge>
      </div>
      <div class="flex items-center gap-1">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-download"
          title="Download .patch file"
          @click="downloadPatch"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-terminal"
          title="Copy git apply command"
          @click="copyGitApply"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
          title="Copy patch"
          @click="copy(patch, { toast: 'Patch copied' })"
        />
      </div>
    </div>
    <MarkdownPreview :text="'```diff\n' + patch + '\n```'" />
    <p v-if="errorLine" class="text-xs text-rose-600 dark:text-rose-400 mt-1">{{ errorLine }}</p>
  </div>
</template>
