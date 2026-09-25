<script setup lang="ts">
/**
 * Create or edit a report schedule: which dashboard, when, compared with what,
 * to which channels. A new schedule takes its filters from the page it was
 * opened on (the analytics scope, or one project); the period comes from the
 * cadence. Opened from *Schedule…* on the analytics and project pages and from
 * the Reports page.
 */
import { offeredDashboards, type BuiltinDashboardKey } from '#shared/analytics/dashboards';
import { WEEKDAY_NAMES, type ReportCadence, type ScheduleComparison } from '#shared/reports/schedule';
import type { ReportScheduleView } from '#shared/handlers/reports';
import type { DashboardList } from '#shared/handlers/dashboards';
import type { ProjectMenuItem } from '~~/types/api';

const props = withDefaults(
  defineProps<{
    /** The scope query keys a new schedule starts from. */
    scope?: Record<string, string>;
    /** A built-in dashboard key or a saved dashboard's id. */
    dashboard?: BuiltinDashboardKey | string;
    /** The schedule being edited; a new one when absent. */
    schedule?: ReportScheduleView | null;
  }>(),
  { scope: () => ({}), dashboard: 'executive', schedule: null },
);

const emit = defineEmits<{ saved: [schedule: ReportScheduleView] }>();
const open = defineModel<boolean>('open', { default: false });

const config = useRuntimeConfig();
const demoMode = !!config.public.demoMode;
const isDesktop = useIsDesktop();
const { canSeeAdmin } = useAuth();
const authEnabled = !!config.public.authEnabled;
const { isHidden } = await useInstanceCapabilities();
const toast = useToast();

interface ChannelItem {
  id: number;
  name: string;
  type: string;
  userId: number | null;
}

// Loaded when the form first opens: the pages render it closed for every reader.
const { data: channelData, execute: loadChannels } = useFetch<{ items: ChannelItem[] }>('/api/channels', {
  server: false,
  lazy: true,
  immediate: false,
  default: () => ({ items: [] }),
});
const { data: scheduleData, execute: loadScheduleOptions } = useFetch<{
  timeZone: string;
  owners: Array<{ owner: string; projectIds: number[] }>;
}>('/api/reports/schedules', {
  server: false,
  lazy: true,
  immediate: false,
  default: () => ({ timeZone: 'UTC', owners: [] }),
});
const { data: dashboardList, execute: loadDashboards } = useFetch<DashboardList>('/api/analytics/dashboards', {
  server: false,
  lazy: true,
  immediate: false,
});
const { data: projectMenu, execute: loadProjects } = useFetch('/api/projects/menu', {
  server: false,
  lazy: true,
  immediate: false,
  default: () => [] as ProjectMenuItem[],
  transform: (r: { items: ProjectMenuItem[] }) => r.items,
});
// Share links need the server; the demo has none, so the switch stays hidden there.
const { data: shareSettings, execute: loadShareSettings } = useFetch<{ enabled: boolean; maxTtlDays: number }>(
  '/api/share-links/settings',
  { server: false, lazy: true, immediate: false },
);
let loaded = false;

const name = ref('');
const dashboardKey = ref<string | undefined>('executive');
const cadence = ref<ReportCadence>('weekly');
const weekday = ref(1);
const dayOfMonth = ref(1);
const at = ref('08:00');
const comparison = ref<ScheduleComparison>('previous');
const language = ref<'auto' | 'en' | 'fr'>('auto');
const channelIds = ref<number[]>([]);
const includeShareLink = ref(false);
const global = ref(false);
const owner = ref<string | undefined>(undefined);
const filters = ref<Record<string, string>>({});
const saving = ref(false);

function reset() {
  const s = props.schedule;
  filters.value = { ...(s ? s.scope : props.scope) };
  delete filters.value.period;
  delete filters.value.tz;
  delete filters.value.locale;
  owner.value = filters.value.owner;
  dashboardKey.value = s
    ? (s.dashboard ?? undefined)
    : props.dashboard === 'team' && !owner.value
      ? 'engineering'
      : props.dashboard;
  name.value = s?.name ?? '';
  cadence.value = s?.cadence ?? 'weekly';
  weekday.value = s && s.cadence !== 'monthly' && s.anchor ? s.anchor : 1;
  dayOfMonth.value = s && s.cadence === 'monthly' && s.anchor ? s.anchor : 1;
  at.value = s?.at ?? '08:00';
  comparison.value = s?.comparison ?? 'previous';
  language.value = s?.language ?? 'auto';
  channelIds.value = s ? s.channels.map((c) => c.id) : [];
  includeShareLink.value = s?.includeShareLink ?? false;
  global.value = s ? s.global : false;
}
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    reset();
    if (!loaded) {
      loaded = true;
      void loadChannels();
      void loadScheduleOptions();
      void loadDashboards();
      if (!demoMode) void loadShareSettings();
      void loadProjects();
    }
  },
  { immediate: true },
);

const scopeProjects = computed(() =>
  (filters.value.projects ?? '')
    .split(',')
    .map(Number)
    .filter((id) => id > 0),
);

/** The owners of the tests in the schedule's projects, for the team dashboard. */
const owners = computed(() => {
  const all = scheduleData.value?.owners ?? [];
  const projects = scopeProjects.value;
  return all
    .filter((o) => projects.length === 0 || o.projectIds.some((id) => projects.includes(id)))
    .map((o) => o.owner);
});

/** The built-in report dashboards, then the saved dashboards the reader can open (a global schedule needs a shared one). */
const dashboardItems = computed(() => {
  const builtins = offeredDashboards({ hasOwner: owners.value.length > 0, testMapHidden: isHidden('test-map') }).map(
    (d) => ({ label: d.name, value: d.key as string, description: d.description }),
  );
  const saved = (dashboardList.value?.items ?? [])
    .filter((d) => d.kind === 'saved' && (!global.value || d.visibility === 'shared' || !authEnabled))
    .map((d) => ({ label: d.name, value: d.id, description: d.description ?? undefined }));
  return saved.length > 0
    ? [
        { type: 'label' as const, label: 'Built-in' },
        ...builtins,
        { type: 'label' as const, label: 'Saved dashboards' },
        ...saved,
      ]
    : builtins;
});

const cadenceItems = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Every other week', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
];
const weekdayItems = WEEKDAY_NAMES.map((label, i) => ({ label, value: i + 1 }));
const dayItems = Array.from({ length: 28 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));
const comparisonItems = [
  { label: 'The previous period', value: 'previous' },
  { label: 'The same period a year earlier', value: 'year-ago' },
  { label: 'No comparison', value: 'none' },
];
const languageItems = [
  { label: 'Default language', value: 'auto' },
  { label: 'English', value: 'en' },
  { label: 'Français', value: 'fr' },
];

/** Global schedules send to global channels; a personal one to the author's own or a global channel. */
const channelItems = computed(() =>
  (channelData.value?.items ?? [])
    .filter((c) => !global.value || c.userId === null)
    .map((c) => ({ label: `${c.name} (${channelTypeLabel(c.type)})`, value: c.id })),
);

function channelTypeLabel(type: string): string {
  if (type === 'email' || type === 'personal_email') return 'email';
  if (type === 'slack') return 'Slack';
  if (type === 'teams') return 'Microsoft Teams';
  if (type === 'webhook') return 'webhook';
  if (type === 'browser') return 'browser';
  return type;
}

watch(global, () => {
  const allowed = new Set(channelItems.value.map((c) => c.value));
  channelIds.value = channelIds.value.filter((id) => allowed.has(id));
});

const projectNames = computed(() => new Map((projectMenu.value ?? []).map((p) => [p.id, p.label || p.name])));

/** The schedule's filters in words: they come from the page it was opened on. */
const filterSummary = computed(() => {
  const f = filters.value;
  const parts: string[] = [];
  parts.push(
    scopeProjects.value.length === 0
      ? 'All projects you can open'
      : scopeProjects.value.map((id) => projectNames.value.get(id) ?? `#${id}`).join(', '),
  );
  if (f.environments) parts.push(`environments ${f.environments}`);
  if (f.branches) parts.push(`branches ${f.branches}`);
  else parts.push(f.allBranches === 'true' ? 'all branches' : 'default branches');
  if (f.sel) parts.push(`selection ${f.sel}`);
  if (f.tags) parts.push(`tags ${f.tags}`);
  if (f.browsers) parts.push(`browsers ${f.browsers}`);
  if (f.fullRunsOnly === 'false') parts.push('full and partial runs');
  return parts.join(' · ');
});

const timeZoneNote = computed(() => {
  const tz = scheduleData.value?.timeZone ?? 'UTC';
  return tz === 'UTC'
    ? 'Times are in UTC: the instance time zone is left to each browser, and a schedule has no browser.'
    : `Times are in the instance time zone, ${tz}.`;
});

const needsOwner = computed(() => dashboardKey.value === 'team');
const valid = computed(
  () =>
    name.value.trim().length > 0 &&
    !!dashboardKey.value &&
    channelIds.value.length > 0 &&
    (!needsOwner.value || !!owner.value),
);

async function save() {
  if (!valid.value) return;
  saving.value = true;
  const scope = { ...filters.value };
  if (needsOwner.value && owner.value) scope.owner = owner.value;
  else delete scope.owner;
  const body = {
    name: name.value.trim(),
    dashboard: dashboardKey.value,
    scope,
    cadence: cadence.value,
    anchor: cadence.value === 'daily' ? null : cadence.value === 'monthly' ? dayOfMonth.value : weekday.value,
    at: at.value,
    comparison: comparison.value,
    language: language.value === 'auto' ? null : language.value,
    channelIds: channelIds.value,
    includeShareLink: includeShareLink.value,
    ...(authEnabled && canSeeAdmin.value ? { global: global.value } : {}),
  };
  try {
    const saved = props.schedule
      ? await $fetch<ReportScheduleView>(`/api/reports/schedules/${props.schedule.id}`, { method: 'PATCH', body })
      : await $fetch<ReportScheduleView>('/api/reports/schedules', { method: 'POST', body });
    toast.add({ title: props.schedule ? 'Report schedule saved' : 'Report schedule created', color: 'success' });
    emit('saved', saved);
    open.value = false;
  } catch (error) {
    toast.add({ title: "Couldn't save the report schedule", description: errorMessage(error), color: 'error' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ClientOnly>
    <UModal
      v-model:open="open"
      :title="schedule ? 'Edit report schedule' : 'Schedule a quality report'"
      description="A quality report delivered on a schedule, each one kept as a snapshot on the Reports page."
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #body>
        <form class="space-y-4" data-testid="schedule-form" @submit.prevent="save">
          <UAlert
            v-if="demoMode"
            icon="i-lucide-info"
            color="neutral"
            variant="subtle"
            title="The demo has no scheduler"
            description="A schedule is stored in your browser but never fires by itself. Run now keeps a snapshot without sending it."
          />
          <UAlert
            v-else-if="isDesktop"
            icon="i-lucide-info"
            color="neutral"
            variant="subtle"
            description="A schedule fires while the desktop app is running."
          />

          <UFormField label="Name" required>
            <UInput v-model="name" class="w-full" placeholder="Weekly quality report" data-testid="schedule-name" />
          </UFormField>

          <UFormField label="Dashboard">
            <UAlert
              v-if="schedule?.inactiveReason"
              icon="i-lucide-info"
              color="neutral"
              variant="subtle"
              class="mb-2"
              :description="schedule.inactiveReason"
            />
            <div class="flex items-center gap-2">
              <USelect
                v-model="dashboardKey"
                :items="dashboardItems"
                class="w-full"
                placeholder="Pick a dashboard"
                aria-label="Report dashboard"
                data-testid="schedule-dashboard"
              />
              <HelpHint topic="reports.schedule" />
            </div>
            <p v-if="owners.length === 0" class="text-xs text-muted mt-1">
              The team dashboard needs tests with an owner (a <code class="font-mono">piwi:owner</code> annotation or
              CODEOWNERS); none of the tests in scope has one.
            </p>
          </UFormField>

          <UFormField v-if="needsOwner" label="Owner" required>
            <USelect
              v-model="owner"
              :items="owners"
              class="w-full"
              placeholder="Pick a team"
              aria-label="Owner"
              data-testid="schedule-owner"
            />
          </UFormField>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <UFormField label="Cadence">
              <USelect v-model="cadence" :items="cadenceItems" class="w-full" data-testid="schedule-cadence" />
            </UFormField>
            <UFormField v-if="cadence === 'weekly' || cadence === 'biweekly'" label="On">
              <USelect v-model="weekday" :items="weekdayItems" class="w-full" aria-label="Weekday" />
            </UFormField>
            <UFormField v-else-if="cadence === 'monthly'" label="Day of month">
              <USelect v-model="dayOfMonth" :items="dayItems" class="w-full" aria-label="Day of month" />
            </UFormField>
            <UFormField label="At">
              <UInput v-model="at" type="time" class="w-full" data-testid="schedule-at" />
            </UFormField>
          </div>
          <p class="text-xs text-muted -mt-2">
            {{ timeZoneNote }} Each report covers the whole days since the previous one.
          </p>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UFormField label="Compared with">
              <USelect v-model="comparison" :items="comparisonItems" class="w-full" />
            </UFormField>
            <UFormField label="Language">
              <USelect v-model="language" :items="languageItems" class="w-full" />
            </UFormField>
          </div>

          <UFormField v-if="authEnabled && canSeeAdmin" label="Global schedule">
            <div class="flex items-center gap-2">
              <USwitch v-model="global" />
              <span class="text-xs text-muted">Every project, sent to global channels only.</span>
            </div>
          </UFormField>

          <UFormField label="Send to" required>
            <USelectMenu
              v-model="channelIds"
              :items="channelItems"
              value-key="value"
              multiple
              class="w-full"
              placeholder="Pick channels"
              aria-label="Channels"
              data-testid="schedule-channels"
            />
            <p v-if="channelItems.length === 0" class="text-xs text-muted mt-1">
              No channel yet: add one under
              <NuxtLink
                to="/settings/notifications"
                class="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                Settings › Notifications</NuxtLink
              >.
            </p>
          </UFormField>

          <UFormField v-if="shareSettings?.enabled">
            <template #label>
              <span class="inline-flex items-center gap-1">Share link <HelpHint topic="reports.share-link" /></span>
            </template>
            <div class="flex items-center gap-2">
              <USwitch v-model="includeShareLink" data-testid="schedule-share-link" />
              <span class="text-xs text-muted">Each report carries a link that opens it without an account.</span>
            </div>
          </UFormField>

          <div>
            <p class="text-xs font-medium text-muted">Filters</p>
            <p class="text-sm text-highlighted leading-relaxed" data-testid="schedule-filters">{{ filterSummary }}</p>
          </div>
        </form>
      </template>

      <template #footer>
        <div class="flex w-full items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton
            color="primary"
            :loading="saving"
            :disabled="!valid"
            data-testid="schedule-save"
            :label="schedule ? 'Save' : 'Create schedule'"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </ClientOnly>
</template>
