<script setup lang="ts">
import type { ProjectAccessResponse, ProjectAccessUpdateResponse } from '~~/types/api';
import {
  matchesProjectAccessQuery,
  projectAccessCellKey,
  projectAccessProjectName,
  projectAccessUserName,
  withProjectAccess,
  type ProjectAccessUser,
} from '#shared/project-access';

const { data, error, refresh } = await useFetch<ProjectAccessResponse>('/api/project-access');
const toast = useToast();

// A local copy of the rows, so a click shows at once while its save is in flight.
const users = ref<ProjectAccessUser[]>([]);
watch(
  () => data.value?.users,
  (rows) => {
    users.value = rows ? [...rows] : [];
  },
  { immediate: true },
);
const projects = computed(() => data.value?.projects ?? []);

const userQuery = ref('');
const projectQuery = ref('');
const visibleUsers = computed(() =>
  users.value.filter((user) => matchesProjectAccessQuery(userQuery.value, [user.name, user.username])),
);
const visibleProjects = computed(() =>
  projects.value.filter((project) => matchesProjectAccessQuery(projectQuery.value, [project.label, project.name])),
);

function countOf(visible: number, total: number, noun: string): string {
  const counted = `${total} ${noun}${total === 1 ? '' : 's'}`;
  return visible === total ? counted : `${visible} of ${counted}`;
}

const countLine = computed(
  () =>
    `${countOf(visibleUsers.value.length, users.value.length, 'user')} · ${countOf(visibleProjects.value.length, projects.value.length, 'project')}`,
);

// ── Saving: each click is its own request ─────────────────────────────────
const saving = reactive(new Set<string>());
/** Read out by screen readers after each saved change. */
const announcement = ref('');

function patchUser(userId: number, update: (user: ProjectAccessUser) => ProjectAccessUser) {
  users.value = users.value.map((user) => (user.id === userId ? update(user) : user));
}

function targetName(projectId: number | null): string {
  if (projectId === null) return 'every project';
  const project = projects.value.find((p) => p.id === projectId);
  return project ? projectAccessProjectName(project) : 'the project';
}

async function onToggle(userId: number, projectId: number | null, granted: boolean) {
  const key = projectAccessCellKey(userId, projectId);
  const user = users.value.find((u) => u.id === userId);
  if (!user || saving.has(key)) return;

  patchUser(userId, (row) => withProjectAccess(row, projectId, granted));
  saving.add(key);
  try {
    const response = await $fetch<ProjectAccessUpdateResponse>('/api/project-access', {
      method: 'PUT',
      body: { userId, projectId, granted },
    });
    saving.delete(key);
    // Take the server's row once no other change to it is still in flight.
    if (![...saving].some((k) => k.startsWith(`${userId}:`))) patchUser(userId, () => response.user);
    announcement.value = `${projectAccessUserName(user)} ${granted ? 'can now open' : 'can no longer open'} ${targetName(projectId)}`;
  } catch (err) {
    saving.delete(key);
    toast.add({ title: 'Access not changed', description: errorMessage(err), color: 'error' });
    // The user may have been deleted or promoted meanwhile: reload the whole grid.
    await refresh();
  }
}
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="data && !data.authEnabled"
      icon="i-lucide-info"
      color="neutral"
      variant="subtle"
      title="Authentication is disabled"
      description="Project access applies once authentication is enabled with PIWI_AUTH_ENABLED. Until then every visitor opens every project."
    />

    <SectionCard title="Permissions" help="settings.permissions" data-shot="permission-grid">
      <ErrorState v-if="error" :text="`Couldn't load the permission grid: ${errorMessage(error)}`">
        <template #action>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
            Retry
          </UButton>
        </template>
      </ErrorState>

      <EmptyState v-else-if="users.length === 0" text="No users yet. Add one under Users, then grant it projects here.">
        <UButton to="/settings/users" size="sm" color="neutral" variant="outline" label="Open Users" />
      </EmptyState>

      <div v-else class="space-y-4">
        <FilterToolbar>
          <template #start>
            <span class="text-xs text-muted">{{ countLine }}</span>
          </template>
          <UInput
            v-model="userQuery"
            icon="i-lucide-search"
            placeholder="Filter users"
            aria-label="Filter users"
            size="sm"
            class="w-full sm:w-44"
          />
          <UInput
            v-model="projectQuery"
            icon="i-lucide-search"
            placeholder="Filter projects"
            aria-label="Filter projects"
            size="sm"
            class="w-full sm:w-44"
          />
        </FilterToolbar>

        <ProjectAccessGrid
          v-if="visibleUsers.length > 0"
          :users="visibleUsers"
          :projects="visibleProjects"
          :saving="saving"
          @toggle="onToggle"
        />
        <EmptyState v-else text="No user matches this filter." />

        <p v-if="projects.length === 0" class="text-xs text-muted">
          No projects yet — each project gets a column once its first results arrive.
        </p>
        <p v-else-if="visibleProjects.length === 0" class="text-xs text-muted">No project matches this filter.</p>
      </div>

      <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    </SectionCard>
  </div>
</template>
