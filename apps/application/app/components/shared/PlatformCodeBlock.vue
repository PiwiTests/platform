<script setup lang="ts">
/**
 * A code block with a Linux/macOS ↔ Windows toggle, for commands shown to a
 * user where the two shells can differ. Each form keeps its own copy button
 * (the inner CodeBlock), so a reader copies exactly the platform they picked.
 */
const props = defineProps<{
  bash: string;
  powershell: string;
  /** Remember the reader's pick across blocks on the page. */
  storageKey?: string;
}>();

type Shell = 'bash' | 'powershell';
const shell = ref<Shell>('bash');

// A per-viewer convenience only; never fails the render when storage is blocked.
onMounted(() => {
  if (!props.storageKey) return;
  try {
    const saved = localStorage.getItem(props.storageKey);
    if (saved === 'bash' || saved === 'powershell') shell.value = saved;
  } catch {
    // Ignore — private windows and blocked storage both leave the default.
  }
});

function pick(next: Shell) {
  shell.value = next;
  if (!props.storageKey) return;
  try {
    localStorage.setItem(props.storageKey, next);
  } catch {
    // Ignore — the choice still applies for this view.
  }
}

const code = computed(() => (shell.value === 'bash' ? props.bash : props.powershell));
const lang = computed(() => (shell.value === 'bash' ? 'bash' : 'powershell'));
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center gap-1" role="tablist" aria-label="Shell">
      <UButton
        size="xs"
        :color="shell === 'bash' ? 'primary' : 'neutral'"
        :variant="shell === 'bash' ? 'subtle' : 'ghost'"
        role="tab"
        :aria-selected="shell === 'bash'"
        @click="pick('bash')"
      >
        Linux / macOS
      </UButton>
      <UButton
        size="xs"
        :color="shell === 'powershell' ? 'primary' : 'neutral'"
        :variant="shell === 'powershell' ? 'subtle' : 'ghost'"
        role="tab"
        :aria-selected="shell === 'powershell'"
        @click="pick('powershell')"
      >
        Windows (PowerShell)
      </UButton>
    </div>
    <CodeBlock :code="code" :lang="lang" />
  </div>
</template>
