<script setup lang="ts">
/**
 * The per-project tracker binding form (admin, project Settings tab): which
 * connection and Jira project/issue type a failure files into, the default
 * labels and assignee, the ticket language, what a ticket carries, the two-way
 * sync policies, the owner routes, and the auto-create fields (greyed out — the
 * trigger is not enabled yet). Saves the whole resolved binding to
 * PUT /api/projects/:id/integrations.
 *
 * The form holds strings (never null) so the inputs bind cleanly; the server
 * normalizes and clamps the payload on save.
 */
import { DEFAULT_PROJECT_INTEGRATION, type ResolvedProjectIntegration } from '#shared/integrations/binding';
import { SUPPORTED_LOCALES } from '#shared/integrations/messages';
import type { TrackerSummary, TrackerProjectOption, TrackerIssueTypeOption } from '#shared/integrations/types';

const props = defineProps<{ projectId: number }>();
const toast = useToast();

interface RouteForm {
  owner: string;
  projectKey: string;
  componentId: string;
  assigneeAccountId: string;
  labels: string;
}

const form = reactive({
  connectionId: 0,
  projectKey: '',
  issueType: '',
  defaultAssignee: '',
  locale: '' as '' | 'en' | 'fr',
  labels: '',
  include: { ...DEFAULT_PROJECT_INTEGRATION.include },
  policies: {
    ...DEFAULT_PROJECT_INTEGRATION.policies,
    fixTransitionId: '',
    reopenTransitionId: '',
  },
  ownerRoutes: [] as RouteForm[],
  autoCreate: { ...DEFAULT_PROJECT_INTEGRATION.autoCreate },
});

const connections = ref<TrackerSummary[]>([]);
const jiraProjects = ref<TrackerProjectOption[]>([]);
const issueTypes = ref<TrackerIssueTypeOption[]>([]);
const loading = ref(true);
const saving = ref(false);

const localeItems = [
  { label: 'Inherit from connection', value: '' },
  ...SUPPORTED_LOCALES.map((l) => ({ label: l, value: l })),
];
const connectionItems = computed(() => [
  { label: 'None — unbound', value: 0 },
  ...connections.value.map((c) => ({ label: c.name, value: c.id })),
]);
const projectKeyItems = computed(() =>
  jiraProjects.value.map((p) => ({ label: `${p.key} — ${p.name}`, value: p.key })),
);
const issueTypeItems = computed(() => issueTypes.value.map((t) => ({ label: t.name, value: t.id })));

async function loadPickers() {
  if (!form.connectionId) {
    jiraProjects.value = [];
    issueTypes.value = [];
    return;
  }
  try {
    const { projects } = await $fetch<{ projects: TrackerProjectOption[] }>(
      `/api/integrations/connections/${form.connectionId}/projects`,
    );
    jiraProjects.value = projects;
  } catch {
    jiraProjects.value = [];
  }
  await loadIssueTypes();
}

async function loadIssueTypes() {
  if (!form.connectionId || !form.projectKey) {
    issueTypes.value = [];
    return;
  }
  try {
    const { issueTypes: t } = await $fetch<{ issueTypes: TrackerIssueTypeOption[] }>(
      `/api/integrations/connections/${form.connectionId}/projects/${encodeURIComponent(form.projectKey)}/issue-types`,
    );
    issueTypes.value = t;
  } catch {
    issueTypes.value = [];
  }
}

function fromBinding(b: ResolvedProjectIntegration) {
  form.connectionId = b.connectionId ?? 0;
  form.projectKey = b.projectKey ?? '';
  form.issueType = b.issueType ?? '';
  form.defaultAssignee = b.defaultAssignee ?? '';
  form.locale = b.locale ?? '';
  form.labels = (b.labels ?? []).join(', ');
  form.include = { ...b.include };
  form.policies = {
    ...b.policies,
    fixTransitionId: b.policies.fixTransitionId ?? '',
    reopenTransitionId: b.policies.reopenTransitionId ?? '',
  };
  form.ownerRoutes = (b.ownerRoutes ?? []).map((r) => ({
    owner: r.owner,
    projectKey: r.projectKey ?? '',
    componentId: r.componentId ?? '',
    assigneeAccountId: r.assigneeAccountId ?? '',
    labels: (r.labels ?? []).join(', '),
  }));
  form.autoCreate = { ...b.autoCreate };
}

function toBinding(): Partial<ResolvedProjectIntegration> {
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    connectionId: form.connectionId || null,
    projectKey: form.projectKey || null,
    issueType: form.issueType || null,
    defaultAssignee: form.defaultAssignee || null,
    locale: form.locale || null,
    labels: list(form.labels),
    include: { ...form.include },
    policies: {
      ...form.policies,
      fixTransitionId: form.policies.fixTransitionId || null,
      reopenTransitionId: form.policies.reopenTransitionId || null,
    },
    ownerRoutes: form.ownerRoutes
      .filter((r) => r.owner.trim())
      .map((r) => ({
        owner: r.owner.trim(),
        projectKey: r.projectKey || null,
        componentId: r.componentId || null,
        assigneeAccountId: r.assigneeAccountId || null,
        labels: list(r.labels),
      })),
    autoCreate: { ...form.autoCreate },
  };
}

async function load() {
  loading.value = true;
  try {
    const [binding, status] = await Promise.all([
      $fetch<ResolvedProjectIntegration>(`/api/projects/${props.projectId}/integrations`),
      $fetch<{ trackers: TrackerSummary[] }>(`/api/integrations/status`).catch(() => ({ trackers: [] })),
    ]);
    fromBinding(binding);
    connections.value = status.trackers ?? [];
    await loadPickers();
  } catch (err) {
    toast.add({ title: 'Could not load the binding', description: errorMessage(err), color: 'error' });
  } finally {
    loading.value = false;
  }
}

function addRoute() {
  form.ownerRoutes.push({ owner: '', projectKey: '', componentId: '', assigneeAccountId: '', labels: '' });
}
function removeRoute(i: number) {
  form.ownerRoutes.splice(i, 1);
}

async function save() {
  saving.value = true;
  try {
    const saved = await $fetch<ResolvedProjectIntegration>(`/api/projects/${props.projectId}/integrations`, {
      method: 'PUT',
      body: toBinding(),
    });
    fromBinding(saved);
    toast.add({ title: 'Integration binding saved', color: 'success' });
  } catch (err) {
    toast.add({ title: 'Could not save the binding', description: errorMessage(err), color: 'error' });
  } finally {
    saving.value = false;
  }
}

watch(() => form.connectionId, loadPickers);
watch(() => form.projectKey, loadIssueTypes);
onMounted(load);
</script>

<template>
  <SectionCard
    icon="i-lucide-ticket"
    title="Issue tracker"
    subtitle="File this project's failures into Jira and keep the ticket in sync"
    data-shot="project-integration-binding"
  >
    <template #actions>
      <UButton label="Save" icon="i-lucide-check" size="sm" :loading="saving" :disabled="loading" @click="save" />
    </template>

    <LoadingState v-if="loading" />
    <div v-else-if="connections.length === 0" class="text-sm text-muted">
      No tracker connection yet — connect Jira in
      <ULink to="/settings/integrations" class="underline decoration-dotted">Settings → Integrations</ULink> first.
    </div>
    <div v-else class="space-y-6">
      <!-- Destination -->
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Connection">
          <USelectMenu v-model="form.connectionId" :items="connectionItems" value-key="value" class="w-full" />
        </UFormField>
        <UFormField label="Ticket language">
          <USelectMenu v-model="form.locale" :items="localeItems" value-key="value" class="w-full" />
        </UFormField>
        <UFormField label="Jira project">
          <USelectMenu
            v-model="form.projectKey"
            :items="projectKeyItems"
            value-key="value"
            searchable
            create-item
            placeholder="Project key"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Issue type">
          <USelectMenu
            v-model="form.issueType"
            :items="issueTypeItems"
            value-key="value"
            placeholder="Issue type"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Default assignee (account id)">
          <UInput v-model="form.defaultAssignee" placeholder="Jira account id" class="w-full" />
        </UFormField>
        <UFormField label="Labels" description="Comma-separated; added to every ticket.">
          <UInput v-model="form.labels" placeholder="team-checkout, e2e" class="w-full" />
        </UFormField>
      </div>

      <!-- What the ticket carries -->
      <div>
        <p class="text-xs font-medium text-muted mb-2">What the ticket carries</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <USwitch v-model="form.include.includeDiagnosis" label="Diagnosis" />
          <USwitch v-model="form.include.includePatch" label="Suggested patch" />
          <USwitch v-model="form.include.includeScreenshot" label="Screenshot attachment" />
          <USwitch v-model="form.include.includeShareLink" label="Shareable report link" />
        </div>
      </div>

      <!-- Sync policies -->
      <div>
        <p class="text-xs font-medium text-muted mb-2">Keep the ticket honest</p>
        <div class="space-y-2">
          <USwitch v-model="form.policies.commentOnFix" label="Comment when the fix lands" />
          <div class="flex items-center gap-2">
            <USwitch v-model="form.policies.transitionOnFix" label="Transition on fix" />
            <UInput
              v-model="form.policies.fixTransitionId"
              :disabled="!form.policies.transitionOnFix"
              placeholder="transition id or status name (e.g. Done)"
              size="xs"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-2">
            <USwitch v-model="form.policies.commentOnRegression" label="Comment on regression" />
            <UInput
              v-model="form.policies.reopenTransitionId"
              placeholder="reopen transition id or status name (optional)"
              size="xs"
              class="flex-1"
            />
          </div>
          <USwitch v-model="form.policies.commentOnNewOccurrences" label="Daily 'still failing' note" />
          <USwitch v-model="form.policies.resolveOnClose" label="Resolve the cluster when the ticket closes" />
          <USwitch v-model="form.policies.reopenOnTicketReopen" label="Reopen the cluster when the ticket reopens" />
          <USwitch v-model="form.policies.commentOnMerge" label="Comment on both tickets when clusters merge" />
        </div>
        <UFormField
          label="Needs-ticket after (days)"
          class="mt-3 max-w-xs"
          description="How long an untracked cluster on the default branch waits before the needs-ticket queue lists it."
        >
          <UInput v-model.number="form.policies.needsTicketAfterDays" type="number" min="0" class="w-full" />
        </UFormField>
      </div>

      <!-- Owner routes -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs font-medium text-muted">Owner routes</p>
          <UButton
            label="Add route"
            icon="i-lucide-plus"
            size="xs"
            variant="outline"
            color="neutral"
            @click="addRoute"
          />
        </div>
        <p class="text-xs text-muted mb-2">
          The cluster's owner picks the first matching route; its overrides fill in on top of the defaults above.
        </p>
        <div v-if="form.ownerRoutes.length === 0" class="text-xs text-muted">
          No routes — every cluster uses the defaults.
        </div>
        <div v-for="(route, i) in form.ownerRoutes" :key="i" class="grid gap-2 sm:grid-cols-5 mb-2 items-center">
          <UInput v-model="route.owner" placeholder="@team or email" size="xs" />
          <UInput v-model="route.projectKey" placeholder="project key" size="xs" />
          <UInput v-model="route.componentId" placeholder="component id" size="xs" />
          <UInput v-model="route.assigneeAccountId" placeholder="assignee id" size="xs" />
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            color="neutral"
            variant="ghost"
            :title="`Remove route ${i + 1}`"
            @click="removeRoute(i)"
          />
        </div>
      </div>

      <!-- Auto-create (inert) -->
      <div class="rounded-lg border border-default p-3 opacity-60">
        <div class="flex items-center gap-2 mb-2">
          <UIcon name="i-lucide-lock" class="size-4 text-muted" />
          <p class="text-xs font-medium text-muted">Automatic creation — not enabled yet</p>
        </div>
        <p class="text-xs text-muted mb-3">
          These are stored but inert: Piwi does not file tickets automatically in this release.
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Min occurrences">
            <UInput v-model.number="form.autoCreate.minOccurrences" type="number" disabled class="w-full" />
          </UFormField>
          <UFormField label="Min runs">
            <UInput v-model.number="form.autoCreate.minRuns" type="number" disabled class="w-full" />
          </UFormField>
          <UFormField label="Daily cap">
            <UInput v-model.number="form.autoCreate.dailyCap" type="number" disabled class="w-full" />
          </UFormField>
          <USwitch
            v-model="form.autoCreate.routeUnmatchedToDefault"
            disabled
            label="Route unmatched owners to default"
          />
        </div>
      </div>
    </div>
  </SectionCard>
</template>
