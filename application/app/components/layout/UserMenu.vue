<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';

defineProps<{
  collapsed?: boolean;
}>();

const colorMode = useColorMode();
const appConfig = useAppConfig();
const config = useRuntimeConfig();
const { authState, logout } = useAuth();

const colors = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];
const neutrals = ['slate', 'gray', 'zinc', 'neutral', 'stone'];

const user = computed(() => {
  if (config.public.authEnabled && authState.value.authenticated && authState.value.user) {
    const avatarUrl = authState.value.user.avatarUrl;
    return {
      name: authState.value.user.name || authState.value.user.username,
      icon: avatarUrl ? undefined : 'i-lucide-user',
      avatar: avatarUrl ? { src: avatarUrl } : undefined,
      role: authState.value.user.role,
    };
  }
  return {
    name: 'Configuration',
    icon: 'i-lucide-cog',
  };
});

const items = computed<DropdownMenuItem[][]>(() => {
  const configurationMenuItems: DropdownMenuItem[] = [];

  if (!config.public.authEnabled || (authState.value.authenticated && authState.value.user?.role === 'administrator')) {
    configurationMenuItems.push(...useSettingsNav());
  }

  const baseItems: DropdownMenuItem[][] = [
    configurationMenuItems,
    [
      {
        label: 'Theme',
        icon: 'i-lucide-palette',
        children: [
          {
            label: 'Primary',
            slot: 'chip',
            chip: appConfig.ui.colors.primary,
            content: {
              align: 'center',
              collisionPadding: 16,
            },
            children: colors.map((color) => ({
              label: color,
              chip: color,
              slot: 'chip',
              checked: appConfig.ui.colors.primary === color,
              type: 'checkbox',
              onSelect: (e) => {
                e.preventDefault();

                appConfig.ui.colors.primary = color;
              },
            })),
          },
          {
            label: 'Neutral',
            slot: 'chip',
            chip: appConfig.ui.colors.neutral === 'neutral' ? 'old-neutral' : appConfig.ui.colors.neutral,
            content: {
              align: 'end',
              collisionPadding: 16,
            },
            children: neutrals.map((color) => ({
              label: color,
              chip: color === 'neutral' ? 'old-neutral' : color,
              slot: 'chip',
              type: 'checkbox',
              checked: appConfig.ui.colors.neutral === color,
              onSelect: (e) => {
                e.preventDefault();

                appConfig.ui.colors.neutral = color;
              },
            })),
          },
        ],
      },
      {
        label: 'Appearance',
        icon: 'i-lucide-sun-moon',
        children: [
          {
            label: 'Light',
            icon: 'i-lucide-sun',
            type: 'checkbox',
            checked: colorMode.value === 'light',
            onSelect(e: Event) {
              e.preventDefault();

              colorMode.preference = 'light';
            },
          },
          {
            label: 'Dark',
            icon: 'i-lucide-moon',
            type: 'checkbox',
            checked: colorMode.value === 'dark',
            onUpdateChecked(checked: boolean) {
              if (checked) {
                colorMode.preference = 'dark';
              }
            },
            onSelect(e: Event) {
              e.preventDefault();
            },
          },
        ],
      },
    ],
    [
      {
        label: 'GitHub repository',
        icon: 'i-lucide-github',
        to: 'https://github.com/piwitests/platform',
        target: '_blank',
      },
    ],
  ];

  // Add logout button if authenticated
  if (config.public.authEnabled && authState.value.authenticated) {
    baseItems.push([
      {
        label: 'Logout',
        icon: 'i-lucide-log-out',
        onSelect: async (e: Event) => {
          e.preventDefault();
          await logout();
        },
      },
    ]);
  }

  return baseItems;
});
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      v-bind="{
        ...user,
        label: collapsed ? undefined : user?.name,
        trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down',
      }"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{
        trailingIcon: 'text-dimmed',
      }"
    />

    <template #chip-leading="{ item }">
      <div class="inline-flex items-center justify-center shrink-0 size-5">
        <span
          class="rounded-full ring ring-bg bg-(--chip-light) dark:bg-(--chip-dark) size-2"
          :style="{
            '--chip-light': `var(--color-${(item as any).chip}-500)`,
            '--chip-dark': `var(--color-${(item as any).chip}-400)`,
          }"
        />
      </div>
    </template>
  </UDropdownMenu>
</template>
