<script setup lang="ts">
/**
 * Desktop build only: pairing Piwi Picker with this app, so **Run with
 * Playwright** in its Replay can send a bug report's steps here. The extension
 * cannot read `~/.piwi/desktop.json`, so its options take this address and
 * token by hand. Every request it sends waits for a click in this window.
 */
defineProps<{
  /** Base server URL, e.g. `http://127.0.0.1:1234`. */
  url: string;
  /** The `pd_` access token enforced by the desktop guard. */
  token: string;
}>();

const { copy } = useCopy();
</script>

<template>
  <SectionCard icon="i-lucide-plug-zap" title="Connect Piwi Picker">
    <template #subtitle>
      Let the browser extension ask this app to run a bug report with Playwright, in a project linked to its folder.
    </template>

    <div class="space-y-3 text-sm" data-shot="desktop-picker-card">
      <p class="text-muted">
        In Piwi Picker's options, under <strong>Desktop app</strong>, paste this address and token. A request it sends
        shows here first: nothing runs until you click <strong>Run with Playwright</strong>.
      </p>
      <div class="space-y-1">
        <div class="text-muted">Address</div>
        <div class="flex items-start gap-2">
          <code class="text-xs break-all flex-1">{{ url }}</code>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Copy address"
            @click="copy(url, { toast: true })"
          />
        </div>
      </div>
      <div class="space-y-1">
        <div class="text-muted">Token</div>
        <div class="flex items-start gap-2">
          <code class="text-xs break-all flex-1">{{ token }}</code>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Copy token"
            @click="copy(token, { toast: true })"
          />
        </div>
      </div>
    </div>
  </SectionCard>
</template>
