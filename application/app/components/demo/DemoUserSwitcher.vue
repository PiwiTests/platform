<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { Role } from '~~/shared/types';

const { demoUsers, currentDemoUserId, setDemoUser } = useAuth();

const roleLabel: Record<string, string> = {
  [Role.ADMINISTRATOR]: 'Admin',
  [Role.REPORTER]: 'Reporter',
  [Role.USER]: 'User',
};

const current = computed(() => demoUsers.find((u) => u.id === currentDemoUserId.value) ?? demoUsers[0]);

function accessSummary(u: (typeof demoUsers)[number]): string {
  if (u.role === Role.ADMINISTRATOR) return 'All projects';
  if (u.assignment.global) return 'All projects';
  if (u.assignment.projectIds.length === 0) return 'No project access';
  return `${u.assignment.projectIds.length} project${u.assignment.projectIds.length > 1 ? 's' : ''}`;
}

const items = computed<DropdownMenuItem[][]>(() => [
  demoUsers.map((u) => ({
    label: `${u.name} · ${roleLabel[u.role]}`,
    icon: u.role === Role.ADMINISTRATOR ? 'i-lucide-shield' : 'i-lucide-user',
    // checkbox so the active identity is marked
    type: 'checkbox' as const,
    checked: u.id === currentDemoUserId.value,
    onSelect: (e: Event) => {
      e.preventDefault();
      if (u.id !== currentDemoUserId.value) setDemoUser(u.id);
    },
  })),
]);
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end', collisionPadding: 12 }" :ui="{ content: 'w-64' }">
    <UButton
      color="warning"
      variant="soft"
      size="xs"
      icon="i-lucide-user-round-cog"
      trailing-icon="i-lucide-chevrons-up-down"
      :label="`Acting as: ${current?.name}`"
      :title="`Switch demo user — currently ${current?.name} (${accessSummary(current!)})`"
    />
  </UDropdownMenu>
</template>
