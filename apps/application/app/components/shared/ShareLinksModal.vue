<script setup lang="ts">
import { Role } from '#shared/types';

interface ShareLinkSummary {
  id: number;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
}

const props = withDefaults(
  defineProps<{
    /** API path the mint/list endpoints live at, e.g. `/api/failure-clusters/12/share-links`. */
    endpoint: string;
    /**
     * What the link opens: an investigation (an execution or a failure cluster), a report snapshot,
     * or a saved dashboard rendered live. A report or a dashboard link also gets a badge and a chart image.
     */
    kind?: 'investigation' | 'report' | 'dashboard';
    /** Render the Share button; without it the parent opens the modal through `v-model:open`. */
    trigger?: boolean;
  }>(),
  { kind: 'investigation', trigger: true },
);

const open = defineModel<boolean>('open', { default: false });

const toast = useToast();
const { copy } = useCopy();
const { hasRole } = useAuth();
const config = useRuntimeConfig();

const settings = ref<{ enabled: boolean; maxTtlDays: number } | null>(null);
const links = ref<ShareLinkSummary[]>([]);
const loading = ref(false);
const minting = ref(false);
const mintedUrl = ref<string | null>(null);
const mintedBadgeUrl = ref<string | null>(null);
const mintedChartUrl = ref<string | null>(null);

const COPY = {
  investigation: {
    title: 'Share links',
    description: 'Read-only links anyone can open — no account needed.',
    minted: 'Anyone holding it can view this investigation until it expires or is revoked.',
    empty: 'No share links yet for this page.',
    footer: 'A link renders the same bounded report as an offline export, live at view time —',
  },
  report: {
    title: 'Share this quality report',
    description: 'A read-only link to this report snapshot, with a status badge. No account needed.',
    minted: 'Anyone holding it can read this quality report until it expires or is revoked.',
    empty: 'No share links yet for this quality report.',
    footer: 'The link shows the report as it was generated, whatever retention did since —',
  },
  dashboard: {
    title: 'Live dashboard links',
    description: 'A read-only page for a wall screen or a bookmark, computed at every view. No account needed.',
    minted:
      'Anyone holding it sees this dashboard, computed with your project access, until it expires, is revoked, or you lose that access.',
    empty: 'No live dashboard links yet.',
    footer: 'The page reloads every minute and never serves evidence files —',
  },
} as const;
const copyText = computed(() => COPY[props.kind]);
const markdownBadge = computed(() =>
  mintedBadgeUrl.value && mintedUrl.value ? `[![Piwi](${mintedBadgeUrl.value})](${mintedUrl.value})` : null,
);

// UI affordance only — the server enforces roles from each route's meta.
const canManage = computed(() => !config.public.authEnabled || hasRole([Role.ADMINISTRATOR, Role.REPORTER]));

const ttlDays = ref<number | undefined>(undefined);
const ttlOptions = computed(() => {
  const max = settings.value?.maxTtlDays ?? 30;
  const presets = [1, 7, 30, 90, 365].filter((days) => max === 0 || days <= max);
  const options = presets.map((days) => ({ label: days === 1 ? '1 day' : `${days} days`, value: days }));
  if (max === 0) options.push({ label: 'No expiry', value: 0 });
  else if (!presets.includes(max)) options.push({ label: `${max} days`, value: max });
  return options;
});

watch(open, async (isOpen) => {
  if (!isOpen) {
    mintedUrl.value = null;
    mintedBadgeUrl.value = null;
    mintedChartUrl.value = null;
    return;
  }
  loading.value = true;
  try {
    const [settingsData, listData] = await Promise.all([
      $fetch<{ enabled: boolean; maxTtlDays: number }>('/api/share-links/settings'),
      $fetch<{ items: ShareLinkSummary[] }>(props.endpoint),
    ]);
    settings.value = settingsData;
    links.value = listData.items;
    ttlDays.value ??= settingsData.maxTtlDays === 0 ? 0 : Math.min(30, settingsData.maxTtlDays);
  } catch (error) {
    toast.add({ title: 'Could not load share links', description: errorMessage(error), color: 'error' });
  } finally {
    loading.value = false;
  }
});

async function mint() {
  minting.value = true;
  try {
    const result = await $fetch<{ url: string; badgeUrl?: string; chartUrl?: string }>(props.endpoint, {
      method: 'POST',
      body: { ttlDays: ttlDays.value === 0 ? null : ttlDays.value },
    });
    mintedUrl.value = result.url;
    mintedBadgeUrl.value = result.badgeUrl ?? null;
    mintedChartUrl.value = result.chartUrl ?? null;
    const listData = await $fetch<{ items: ShareLinkSummary[] }>(props.endpoint);
    links.value = listData.items;
  } catch (error) {
    toast.add({ title: 'Could not create the share link', description: errorMessage(error), color: 'error' });
  } finally {
    minting.value = false;
  }
}

async function revoke(link: ShareLinkSummary) {
  try {
    await $fetch(`/api/share-links/${link.id}`, { method: 'DELETE' });
    toast.add({
      title: 'Share link revoked',
      description: `psl_${link.tokenPrefix}… no longer resolves.`,
      color: 'success',
    });
    const listData = await $fetch<{ items: ShareLinkSummary[] }>(props.endpoint);
    links.value = listData.items;
  } catch (error) {
    toast.add({ title: 'Could not revoke the link', description: errorMessage(error), color: 'error' });
  }
}

function copyMinted() {
  copy(mintedUrl.value, { toast: 'Share link copied to clipboard' });
}

function copyValue(text: string | null, toast: string) {
  copy(text, { toast });
}

function linkState(link: ShareLinkSummary): { label: string; color: 'success' | 'neutral' | 'warning' } {
  if (link.revokedAt) return { label: 'Revoked', color: 'neutral' };
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return { label: 'Expired', color: 'neutral' };
  if (link.expiresAt) return { label: `Expires ${formatRelativeTime(link.expiresAt)}`, color: 'success' };
  return { label: 'No expiry', color: 'warning' };
}
</script>

<template>
  <UButton
    v-if="trigger"
    icon="i-lucide-link"
    size="xs"
    color="neutral"
    variant="outline"
    title="Hand this investigation to someone without an account"
    aria-label="Share"
    @click="open = true"
  >
    <span class="hidden xl:inline">Share</span>
  </UButton>

  <UModal v-model:open="open" :title="copyText.title" :description="copyText.description">
    <template #body>
      <LoadingState v-if="loading" text="Loading share links…" />

      <div v-else class="space-y-4">
        <UAlert
          v-if="settings && !settings.enabled"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="Share links are disabled on this instance"
          description="Set PIWI_SHARE_LINKS_ENABLED=true to allow minting them. Existing links stay stored but resolve to 404 while disabled."
        />

        <template v-else>
          <UAlert
            v-if="mintedUrl"
            color="success"
            variant="subtle"
            icon="i-lucide-check"
            title="Link created — copy it now"
            :description="`For safety, the full link is shown only once. ${copyText.minted}`"
          />
          <div v-if="mintedUrl" class="flex gap-2">
            <UInput
              :model-value="mintedUrl"
              readonly
              class="flex-1 min-w-0 font-mono"
              size="sm"
              data-testid="minted-share-url"
            />
            <UButton icon="i-lucide-copy" size="sm" color="neutral" variant="outline" @click="copyMinted">Copy</UButton>
          </div>
          <div v-if="mintedUrl && markdownBadge" class="space-y-2" data-testid="minted-badge">
            <div class="flex items-center gap-2">
              <p class="text-xs font-medium text-muted">Status badge</p>
              <HelpHint topic="share-links.badge" />
            </div>
            <img :src="mintedBadgeUrl!" alt="Status badge" class="h-5 max-w-full" />
            <div class="flex gap-2">
              <UInput :model-value="markdownBadge" readonly class="flex-1 min-w-0 font-mono" size="sm" />
              <UButton
                icon="i-lucide-copy"
                size="sm"
                color="neutral"
                variant="outline"
                title="Copy the badge as Markdown, for a README or a wiki page"
                @click="copyValue(markdownBadge, 'Badge Markdown copied to clipboard')"
                >Copy</UButton
              >
            </div>
            <p v-if="mintedChartUrl" class="text-xs text-muted break-all">
              Trend image: <span class="font-mono">{{ mintedChartUrl }}</span>
            </p>
          </div>

          <div v-else-if="canManage" class="flex items-end gap-2">
            <UFormField label="Expires after" class="flex-1">
              <USelect v-model="ttlDays" :items="ttlOptions" value-key="value" size="sm" class="w-full" />
            </UFormField>
            <UButton icon="i-lucide-plus" size="sm" :loading="minting" @click="mint">Create link</UButton>
          </div>
        </template>

        <div v-if="links.length > 0" class="space-y-1.5">
          <p class="text-xs font-medium text-gray-500">Existing links</p>
          <div
            v-for="link in links"
            :key="link.id"
            class="flex items-center gap-2 rounded-md border border-default px-2.5 py-1.5 text-sm"
          >
            <code class="text-xs">psl_{{ link.tokenPrefix }}…</code>
            <UBadge :color="linkState(link).color" variant="subtle" size="sm">{{ linkState(link).label }}</UBadge>
            <span class="text-xs text-muted ml-auto" :title="link.lastViewedAt ?? undefined">
              {{ link.viewCount }} {{ link.viewCount === 1 ? 'view' : 'views' }}
            </span>
            <UButton
              v-if="canManage && !link.revokedAt"
              icon="i-lucide-ban"
              size="xs"
              color="error"
              variant="ghost"
              title="Revoke — the link stops resolving immediately"
              @click="revoke(link)"
            />
          </div>
        </div>
        <EmptyState v-else-if="settings?.enabled" :text="copyText.empty" />

        <p class="text-xs text-muted">
          <HelpHint v-if="kind === 'dashboard'" topic="dashboards.live-links" class="align-middle" />
          {{ copyText.footer }}
          <DocLink to="features/share-links" no-icon class="text-primary hover:underline">how share links work</DocLink
          >.
        </p>
      </div>
    </template>
  </UModal>
</template>
