<script setup lang="ts">
const config = useRuntimeConfig();
const isDesktop = useIsDesktop();

const { data: versionInfo } = await useFetch('/api/version');

const appVersion = config.public.appVersion as string;
const buildSha = config.public.buildSha as string;
const buildTime = config.public.buildTime as string;
const nodeVersion = config.public.nodeVersion as string;
const authEnabled = config.public.authEnabled as boolean;

const shortSha = computed(() => (buildSha ? buildSha.slice(0, 7) : null));

// The wordmark carries its own dark background, so it reads on either theme.
// Prefixing the base URL keeps it resolvable when the demo is served from /demo/.
const logoSrc = `${(config.app?.baseURL ?? '/').replace(/\/$/, '')}/logo-wide.svg`;

const dbBackendLabel = computed(() => {
  const backend = versionInfo.value?.dbBackend;
  if (backend === 'postgresql') return 'PostgreSQL';
  if (backend === 'sqlite') return 'SQLite';
  return backend ?? null;
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header: the brand mark with the version and build date beside it on
         desktop, stacked and centered on phones. -->
    <div
      class="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left"
    >
      <img :src="logoSrc" alt="Piwi Dashboard" class="h-14 sm:h-16 rounded-xl shrink-0" />
      <div class="text-sm text-muted">
        <p>
          <span class="font-mono text-highlighted">v{{ appVersion }}</span>
          <template v-if="shortSha">
            ·
            <span class="font-mono" :title="buildSha">{{ shortSha }}</span>
          </template>
        </p>
        <p v-if="buildTime" class="mt-0.5">
          <ClientOnly fallback-tag="span" :fallback="`Built ${formatRelativeTime(buildTime)}`">
            <span :title="prettyDateFormat(buildTime)">Built {{ formatRelativeTime(buildTime) }}</span>
          </ClientOnly>
        </p>
      </div>
    </div>

    <SectionCard icon="i-lucide-info" title="Application">
      <StatTileGrid>
        <StatTile label="Node.js" :value="nodeVersion" />
        <StatTile label="Database" :value="dbBackendLabel" />
        <StatTile label="Authentication" :value="authEnabled ? 'Enabled' : 'Disabled'" />
      </StatTileGrid>
    </SectionCard>

    <!-- Desktop shell only (renders nothing without the IPC bridge). Updates stay
         here next to the version they act on; connecting the reporter and MCP
         clients moved to /setup, which is where "how do I hook this up" lives. -->
    <DesktopUpdateCard :current-version="appVersion" />

    <UAlert
      v-if="isDesktop"
      icon="i-lucide-rocket"
      color="neutral"
      variant="subtle"
      title="Connecting the reporter and AI clients"
      description="The URL and access token for this local instance, the data location, and background-service control are on the Setup page."
      :actions="[{ label: 'Open Setup', to: '/setup', color: 'neutral', variant: 'solid', size: 'xs' }]"
    />

    <SectionCard icon="i-lucide-book-open" title="Resources">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <DocLink to="">Documentation</DocLink>
        <ULink to="/docs" class="inline-flex items-center gap-1 text-primary hover:underline"> API reference </ULink>
        <ULink
          to="https://github.com/piwitests/platform"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-primary hover:underline"
        >
          GitHub
          <UIcon name="i-lucide-external-link" class="w-3.5 h-3.5 shrink-0" />
        </ULink>
      </div>
    </SectionCard>
  </div>
</template>
