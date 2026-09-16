<script setup lang="ts">
/**
 * Sign-in state and live usage for the local Claude CLI provider, shown at the
 * top of Settings → AI in the desktop app. The CLI owns authentication, so this
 * card detects it, lets the user sign in/out, and shows the running usage tally.
 */
const { status, loading, signingIn, loginLog, loginUrl, refresh, signIn, signOut } = useClaudeCli();
const toast = useToast();

onMounted(() => {
  if (!status.value) refresh();
});

const signedIn = computed(() => Boolean(status.value?.loggedIn));
const available = computed(() => Boolean(status.value?.available));

const badge = computed<{ label: string; color: 'success' | 'neutral' | 'warning' }>(() => {
  if (!status.value) return { label: 'Checking…', color: 'neutral' };
  if (!available.value) return { label: 'Not installed', color: 'neutral' };
  if (signedIn.value) return { label: 'Signed in', color: 'success' };
  return { label: 'Not signed in', color: 'warning' };
});

const authMethodLabel = computed(() => {
  const m = status.value?.authMethod;
  if (m === 'oauth_token') return 'Claude subscription';
  if (m === 'api_key') return 'API key';
  return m || null;
});

const usage = computed(() => status.value?.usage ?? null);
const hasUsage = computed(() => (usage.value?.calls ?? 0) > 0);

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtCost(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

async function onSignIn() {
  const res = await signIn();
  if (res.success) toast.add({ title: 'Signed in to Claude Code', color: 'success' });
  else toast.add({ title: 'Sign-in failed', description: res.error || 'Unknown error', color: 'error' });
}

async function onSignOut() {
  const res = await signOut();
  if (res.success) toast.add({ title: 'Signed out of Claude Code', color: 'neutral' });
  else toast.add({ title: 'Sign-out failed', description: res.error || 'Unknown error', color: 'error' });
}
</script>

<template>
  <div class="rounded-lg border border-default p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-2">
        <UIcon name="i-lucide-terminal" class="size-5 mt-0.5 text-primary" />
        <div>
          <p class="font-medium inline-flex items-center gap-2">
            Claude Code (local)
            <UBadge :color="badge.color" variant="subtle" size="sm">{{ badge.label }}</UBadge>
          </p>
          <p class="text-sm text-gray-500">
            Runs failure analysis through the <code class="font-mono">claude</code> command on this machine — no API
            key, billed to your Claude Code sign-in.
          </p>
        </div>
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        title="Re-check the CLI"
        @click="refresh(true)"
      >
        Recheck
      </UButton>
    </div>

    <!-- Not installed / not available -->
    <div v-if="status && !available" class="rounded-md bg-elevated/50 px-3 py-2 text-sm space-y-1">
      <p class="text-highlighted">{{ status.error || 'The Claude CLI was not found on this machine.' }}</p>
      <p class="text-gray-500">
        Install Claude Code, then click Recheck. See
        <a
          href="https://code.claude.com/docs"
          target="_blank"
          rel="noopener"
          class="underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >the install guide</a
        >.
      </p>
    </div>

    <!-- Installed: detail + auth actions -->
    <template v-else-if="status && available">
      <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="text-xs font-medium text-muted">Version</dt>
        <dd class="text-highlighted font-mono">{{ status.version || 'unknown' }}</dd>
        <template v-if="signedIn">
          <dt class="text-xs font-medium text-muted">Signed in</dt>
          <dd class="text-highlighted">{{ authMethodLabel }}</dd>
        </template>
        <template v-if="status.binaryPath">
          <dt class="text-xs font-medium text-muted">Path</dt>
          <dd class="text-gray-500 font-mono text-xs truncate" :title="status.binaryPath">{{ status.binaryPath }}</dd>
        </template>
      </dl>

      <div class="flex flex-wrap items-center gap-2">
        <UButton v-if="!signedIn" color="primary" icon="i-lucide-log-in" :loading="signingIn" @click="onSignIn">
          {{ signingIn ? 'Signing in…' : 'Sign in' }}
        </UButton>
        <UButton
          v-else
          color="neutral"
          variant="outline"
          icon="i-lucide-log-out"
          :disabled="signingIn"
          @click="onSignOut"
        >
          Sign out
        </UButton>
        <span v-if="!signedIn && !signingIn" class="text-sm text-gray-500">
          Opens your browser to sign in with your Claude subscription.
        </span>
      </div>

      <!-- Sign-in progress -->
      <div v-if="signingIn || loginUrl" class="rounded-md bg-elevated/50 px-3 py-2 text-sm space-y-1">
        <p v-if="signingIn" class="inline-flex items-center gap-2 text-highlighted">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Complete the sign-in in your browser…
        </p>
        <p v-if="loginUrl" class="text-gray-500 break-all">
          If your browser didn't open, visit:
          <a
            :href="loginUrl"
            target="_blank"
            rel="noopener"
            class="font-mono underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >{{ loginUrl }}</a
          >
        </p>
      </div>

      <!-- Live usage (this session) -->
      <div v-if="hasUsage" class="border-t border-default pt-3">
        <p class="text-xs font-medium text-muted mb-2">Usage this session</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <p class="text-lg font-semibold text-highlighted">{{ usage!.calls }}</p>
            <p class="text-xs text-muted">calls</p>
          </div>
          <div>
            <p class="text-lg font-semibold text-highlighted">{{ fmtCost(usage!.costUsd) }}</p>
            <p class="text-xs text-muted">cost</p>
          </div>
          <div>
            <p class="text-lg font-semibold text-highlighted">{{ fmtTokens(usage!.inputTokens) }}</p>
            <p class="text-xs text-muted">input tokens</p>
          </div>
          <div>
            <p class="text-lg font-semibold text-highlighted">{{ fmtTokens(usage!.outputTokens) }}</p>
            <p class="text-xs text-muted">output tokens</p>
          </div>
        </div>
        <p class="text-xs text-muted mt-2">
          Input tokens count the whole prompt, including Claude Code's cached system context (reused across calls, so it
          is large but cheap). Cost is what the CLI reports at list rates; a Claude subscription bills it to your plan,
          not per call.
        </p>
      </div>
    </template>

    <div v-else class="flex items-center gap-2 py-2 text-sm text-gray-400">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      Checking for the Claude CLI…
    </div>
  </div>
</template>
