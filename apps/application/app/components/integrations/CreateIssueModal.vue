<script setup lang="ts">
import type {
  ExistingIssueCandidate,
  IssueDraft,
  IssueIncludeOptions,
  TrackerProjectOption,
  TrackerIssueTypeOption,
  TrackerUserOption,
} from '#shared/integrations/types';

const props = defineProps<{
  entityType: 'failure_cluster' | 'test_runs_case';
  entityId: number;
}>();

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  /** A ticket was created (key, url) or an existing one linked. */
  created: [{ key: string; url: string }];
  linked: [{ key: string; url: string }];
}>();

const toast = useToast();

const loading = ref(false);
const creating = ref(false);
const error = ref<string | null>(null);
const draft = ref<IssueDraft | null>(null);

// The editable form, seeded from the draft.
const title = ref('');
const connectionId = ref<number | undefined>(undefined);
const projectKey = ref<string | undefined>(undefined);
const issueType = ref<string | undefined>(undefined);
const labels = ref<string[]>([]);
const assignee = ref<string | undefined>(undefined);
const locale = ref<'en' | 'fr'>('en');
const LOCALE_ITEMS = [
  { label: 'English', value: 'en' },
  { label: 'Français', value: 'fr' },
];
const include = ref<IssueIncludeOptions>({
  includeDiagnosis: true,
  includePatch: true,
  includeScreenshot: false,
  includeShareLink: false,
});

// Picker options, loaded lazily from the connection.
const projects = ref<TrackerProjectOption[]>([]);
const issueTypes = ref<TrackerIssueTypeOption[]>([]);
const assignableUsers = ref<TrackerUserOption[]>([]);
const assigneeQuery = ref('');

const showAllCreate = ref(false);

const hasMultipleConnections = computed(() => (draft.value?.connections.length ?? 0) > 1);
const connectionItems = computed(() => (draft.value?.connections ?? []).map((c) => ({ label: c.name, value: c.id })));
const existing = computed<ExistingIssueCandidate[]>(() => draft.value?.existing ?? []);
const canCreate = computed(
  () => !!connectionId.value && !!projectKey.value && !!issueType.value && !!title.value.trim(),
);

function applyDraft(d: IssueDraft) {
  draft.value = d;
  title.value = d.title;
  connectionId.value = d.connectionId ?? undefined;
  projectKey.value = d.projectKey ?? undefined;
  issueType.value = d.issueType ?? undefined;
  labels.value = [...d.labels];
  assignee.value = d.assignee ?? undefined;
  locale.value = d.locale;
  include.value = { ...d.include };
}

async function loadDraft() {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({ entityType: props.entityType, entityId: String(props.entityId) });
    if (connectionId.value) params.set('connectionId', String(connectionId.value));
    params.set('includeDiagnosis', String(include.value.includeDiagnosis));
    params.set('includePatch', String(include.value.includePatch));
    params.set('includeScreenshot', String(include.value.includeScreenshot));
    params.set('includeShareLink', String(include.value.includeShareLink));
    const d = await $fetch<IssueDraft>(`/api/integrations/issue-draft?${params.toString()}`);
    applyDraft(d);
    if (projectKey.value) void loadIssueTypes();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

/** Re-fetch only the preview/labels when a toggle or the connection changes. */
async function refreshPreview() {
  if (!draft.value) return;
  try {
    const params = new URLSearchParams({ entityType: props.entityType, entityId: String(props.entityId) });
    if (connectionId.value) params.set('connectionId', String(connectionId.value));
    params.set('includeDiagnosis', String(include.value.includeDiagnosis));
    params.set('includePatch', String(include.value.includePatch));
    params.set('includeScreenshot', String(include.value.includeScreenshot));
    params.set('includeShareLink', String(include.value.includeShareLink));
    params.set('locale', locale.value);
    const d = await $fetch<IssueDraft>(`/api/integrations/issue-draft?${params.toString()}`);
    // Keep the person's field edits; refresh only the derived preview + labels.
    draft.value = { ...draft.value, markdown: d.markdown, document: d.document, existing: d.existing };
  } catch {
    /* a preview refresh failure is non-fatal */
  }
}

async function loadProjects() {
  if (!connectionId.value || projects.value.length) return;
  try {
    const { projects: p } = await $fetch<{ projects: TrackerProjectOption[] }>(
      `/api/integrations/connections/${connectionId.value}/projects`,
    );
    projects.value = p;
  } catch (err) {
    toast.add({ title: 'Could not load Jira projects', description: errorMessage(err), color: 'error' });
  }
}

async function loadIssueTypes() {
  if (!connectionId.value || !projectKey.value) return;
  try {
    const { issueTypes: t } = await $fetch<{ issueTypes: TrackerIssueTypeOption[] }>(
      `/api/integrations/connections/${connectionId.value}/projects/${encodeURIComponent(projectKey.value)}/issue-types`,
    );
    issueTypes.value = t;
  } catch (err) {
    toast.add({ title: 'Could not load issue types', description: errorMessage(err), color: 'error' });
  }
}

async function searchAssignable() {
  if (!connectionId.value || !projectKey.value) return;
  try {
    const params = new URLSearchParams({ project: projectKey.value, q: assigneeQuery.value });
    const { users } = await $fetch<{ users: TrackerUserOption[] }>(
      `/api/integrations/connections/${connectionId.value}/assignable?${params.toString()}`,
    );
    assignableUsers.value = users;
  } catch {
    /* the modal falls back to the prefilled assignee */
  }
}

const assigneeItems = computed(() => assignableUsers.value.map((u) => ({ label: u.displayName || u.id, value: u.id })));

watch(open, (isOpen) => {
  if (isOpen) {
    projects.value = [];
    issueTypes.value = [];
    showAllCreate.value = false;
    void loadDraft();
  }
});

watch(connectionId, (id, prev) => {
  if (prev != null && id !== prev) {
    projects.value = [];
    issueTypes.value = [];
    void loadProjects();
    void loadIssueTypes();
    void refreshPreview();
  }
});

watch(projectKey, () => {
  issueTypes.value = [];
  void loadIssueTypes();
});

// The language rewrites the whole body, so re-render the preview.
watch(locale, () => void refreshPreview());

async function create() {
  if (!canCreate.value) return;
  creating.value = true;
  try {
    const res = await $fetch<{ status: string; key?: string; url?: string; error?: string }>(
      '/api/integrations/issues',
      {
        method: 'POST',
        body: {
          entityType: props.entityType,
          entityId: props.entityId,
          connectionId: connectionId.value,
          title: title.value.trim(),
          projectKey: projectKey.value,
          issueType: issueType.value,
          labels: labels.value,
          assignee: assignee.value,
          locale: locale.value,
          include: include.value,
        },
      },
    );
    if (res.status === 'done' && res.key && res.url) {
      toast.add({
        title: `${res.key} created`,
        color: 'success',
        actions: [{ label: 'Open', to: res.url, target: '_blank', color: 'neutral', variant: 'outline' }],
      });
      emit('created', { key: res.key, url: res.url });
      open.value = false;
    } else if (res.status === 'pending') {
      toast.add({
        title: 'Filing queued',
        description: 'Jira did not answer immediately; Piwi will retry and link the issue when it lands.',
        color: 'info',
      });
      open.value = false;
    } else {
      error.value = res.error || 'Could not create the issue';
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    creating.value = false;
  }
}

async function linkExisting(candidate: ExistingIssueCandidate) {
  creating.value = true;
  try {
    await $fetch('/api/links', {
      method: 'POST',
      body: {
        entityType: 'failure_cluster',
        entityId: draft.value?.clusterId ?? props.entityId,
        url: candidate.url,
        title: candidate.title,
      },
    });
    toast.add({ title: `Linked ${candidate.key}`, color: 'success' });
    emit('linked', { key: candidate.key, url: candidate.url });
    open.value = false;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Create issue"
    description="File a Jira issue from this failure, with the fix plan as its body."
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <LoadingState v-if="loading" text="Preparing the draft…" />

      <div v-else-if="!draft" class="space-y-3">
        <ErrorText v-if="error" :text="error" />
        <EmptyState v-else text="No tracker is connected." />
      </div>

      <div v-else class="space-y-4">
        <div class="flex justify-end -mb-2">
          <HelpHint topic="integrations.create-issue" />
        </div>
        <!-- Dedupe: lead with an issue that already tracks this failure. -->
        <UAlert
          v-if="existing.length && !showAllCreate"
          color="warning"
          variant="subtle"
          icon="i-lucide-link"
          :title="`${existing[0]!.key} already tracks this${existing[0]!.statusText ? ` (${existing[0]!.statusText})` : ''}`"
          description="Link it to this failure instead of filing a duplicate."
        >
          <template #actions>
            <UButton size="xs" :loading="creating" @click="linkExisting(existing[0]!)"
              >Link {{ existing[0]!.key }}</UButton
            >
            <UButton size="xs" color="neutral" variant="outline" @click="showAllCreate = true">Create anyway</UButton>
          </template>
        </UAlert>

        <template v-if="!existing.length || showAllCreate">
          <UFormField label="Title">
            <UInput v-model="title" class="w-full" />
          </UFormField>

          <UFormField v-if="hasMultipleConnections" label="Connection">
            <USelect v-model="connectionId" :items="connectionItems" value-key="value" class="w-full" />
          </UFormField>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Jira project">
              <USelectMenu
                v-model="projectKey"
                :items="projects.map((p) => ({ label: `${p.key} — ${p.name}`, value: p.key }))"
                value-key="value"
                :placeholder="projectKey || 'Select a project'"
                class="w-full"
                @update:open="loadProjects"
              />
            </UFormField>
            <UFormField label="Issue type">
              <USelectMenu
                v-model="issueType"
                :items="issueTypes.map((t) => ({ label: t.name, value: t.id }))"
                value-key="value"
                :placeholder="issueType || 'Select a type'"
                class="w-full"
                @update:open="loadIssueTypes"
              />
            </UFormField>
          </div>

          <UFormField label="Assignee">
            <USelectMenu
              v-model="assignee"
              :items="assigneeItems"
              value-key="value"
              searchable
              :placeholder="assignee || 'Unassigned'"
              class="w-full"
              @update:open="searchAssignable"
              @update:search-term="
                (q: string) => {
                  assigneeQuery = q;
                  searchAssignable();
                }
              "
            />
          </UFormField>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Labels">
              <UInputMenu v-model="labels" multiple create-item class="w-full" :items="labels" />
            </UFormField>
            <UFormField label="Language">
              <USelect v-model="locale" :items="LOCALE_ITEMS" value-key="value" class="w-full" />
            </UFormField>
          </div>

          <UFormField label="Include">
            <div class="flex flex-wrap gap-4">
              <USwitch v-model="include.includeDiagnosis" label="Diagnosis" @update:model-value="refreshPreview" />
              <USwitch v-model="include.includePatch" label="Patch" @update:model-value="refreshPreview" />
              <USwitch v-model="include.includeScreenshot" label="Screenshot" @update:model-value="refreshPreview" />
              <USwitch v-model="include.includeShareLink" label="Share link" @update:model-value="refreshPreview" />
            </div>
          </UFormField>

          <div>
            <p class="text-xs font-medium text-gray-500 mb-1.5">Preview</p>
            <MarkdownPreview :text="draft.markdown" max-height="16rem" />
          </div>

          <ErrorText v-if="error" :text="error" />
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
        <UButton
          v-if="draft && (!existing.length || showAllCreate)"
          icon="i-simple-icons-jira"
          :loading="creating"
          :disabled="!canCreate"
          @click="create"
        >
          Create
        </UButton>
      </div>
    </template>
  </UModal>
</template>
