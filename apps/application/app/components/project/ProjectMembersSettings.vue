<script setup lang="ts">
/**
 * Project settings → Members (administrators): which reporters and users are
 * assigned this project. Administrators always have access, and a user with
 * global access keeps it until that assignment is removed in Settings → Users.
 */
import type { ProjectMemberEntry, ProjectMembersResponse, UserDetails, UsersResponse } from '~~/types/api';

const props = defineProps<{ projectId: number }>();

const toast = useToast();
const members = ref<ProjectMemberEntry[]>([]);
const allUsers = ref<UserDetails[]>([]);
const selectedMemberIds = ref<number[]>([]);
const loading = ref(true);
const saving = ref(false);

const mergedMembers = computed(() => {
  const memberMap = new Map(members.value.map((m) => [m.id, m]));
  const result: ProjectMemberEntry[] = [];
  for (const u of allUsers.value) {
    if (u.role === 'administrator') continue;
    const m = memberMap.get(u.id);
    result.push({ id: u.id, username: u.username, name: u.name ?? null, role: u.role, global: m?.global ?? false });
  }
  for (const m of members.value) if (m.role === 'administrator') result.push(m);
  return result;
});

const assignedIds = (items: ProjectMemberEntry[]) =>
  items.filter((m) => m.role !== 'administrator' && !m.global).map((m) => m.id);

const membersChanged = computed(
  () => JSON.stringify(assignedIds(members.value).sort()) !== JSON.stringify([...selectedMemberIds.value].sort()),
);

async function load() {
  loading.value = true;
  try {
    const [membersData, usersData] = await Promise.all([
      $fetch<ProjectMembersResponse>(`/api/projects/${props.projectId}/members`),
      $fetch<UsersResponse>('/api/users'),
    ]);
    members.value = membersData.items;
    allUsers.value = usersData.items;
    selectedMemberIds.value = assignedIds(membersData.items);
  } catch {
    members.value = [];
    allUsers.value = [];
    selectedMemberIds.value = [];
  } finally {
    loading.value = false;
  }
}

function toggleMemberSelection(userId: number) {
  const idx = selectedMemberIds.value.indexOf(userId);
  if (idx >= 0) selectedMemberIds.value.splice(idx, 1);
  else selectedMemberIds.value.push(userId);
}

async function save() {
  saving.value = true;
  try {
    await $fetch(`/api/projects/${props.projectId}/members`, {
      method: 'PUT',
      body: { userIds: selectedMemberIds.value },
    });
    toast.add({ title: 'Members updated', color: 'success' });
    const data = await $fetch<ProjectMembersResponse>(`/api/projects/${props.projectId}/members`);
    members.value = data.items;
  } catch (error) {
    toast.add({ title: 'Update failed', description: errorMessage(error), color: 'error' });
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <SectionCard icon="i-lucide-users" title="Members" help="project.members" subtitle="Who can see this project">
    <LoadingState v-if="loading" text="Loading members…" />
    <p v-else-if="mergedMembers.length === 0" class="text-sm text-muted">No users to assign yet.</p>
    <ul v-else class="divide-y divide-default">
      <li
        v-for="member in mergedMembers"
        :key="member.id"
        class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
      >
        <div class="min-w-0">
          <div class="text-sm font-semibold text-highlighted truncate">{{ member.name || member.username }}</div>
          <div class="text-xs text-muted">
            @{{ member.username }} · {{ member.role }}<template v-if="member.global"> · global access</template>
          </div>
        </div>
        <UCheckbox
          v-if="member.role !== 'administrator'"
          :model-value="selectedMemberIds.includes(member.id)"
          :disabled="member.global"
          :aria-label="`${member.name || member.username} can see this project`"
          :title="member.global ? 'Has global access — remove global assignment first' : ''"
          @change="toggleMemberSelection(member.id)"
        />
        <span v-else class="text-xs text-muted">Always</span>
      </li>
    </ul>

    <template #footer>
      <div class="flex justify-end">
        <UButton icon="i-lucide-check" :loading="saving" :disabled="!membersChanged" @click="save">
          Save changes
        </UButton>
      </div>
    </template>
  </SectionCard>
</template>
