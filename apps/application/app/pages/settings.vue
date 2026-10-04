<script setup lang="ts">
import { SETTINGS_GROUPS, SETTINGS_PAGES } from '~/utils/settings-metadata';

useHead({ title: 'Settings — Piwi Dashboard' });

const { envManaged } = useSettingsEnvState();

// Already grouped (Instance / Analysis / meta) and rendered as the tab bar.
// Documentation is not a settings page — it lives in Settings → About →
// Resources and behind every inline-help "Learn more" link.
const navItems = await useSettingsNav(envManaged);

const route = useRoute();

// Mobile: a full-width select replaces the horizontal strip, which at phone
// width shrinks to an unlabeled, horizontally scrolling row of icons. It keeps
// the same Instance / Analysis grouping (a `label` row heads each section) and
// is driven by the current route. Built from the registry so labels and order
// match the strip, filtered to the pages this viewer can actually see.
type SettingsSelectItem = { label: string; type?: 'label'; icon?: string; value?: string };

const selectItems = computed<SettingsSelectItem[]>(() => {
  const visible = new Set(navItems.value.flat().map((item) => item.to as string));
  const items: SettingsSelectItem[] = [];
  for (const group of SETTINGS_GROUPS) {
    const pages = SETTINGS_PAGES.filter((page) => page.group === group.id && visible.has(page.to));
    if (!pages.length) continue;
    if (group.label) items.push({ type: 'label', label: group.label });
    for (const page of pages) items.push({ label: page.label, icon: page.icon, value: page.to });
  }
  return items;
});

const currentPage = computed({
  get: () => route.path,
  set: (to: string) => {
    if (to && to !== route.path) navigateTo(to);
  },
});

const currentIcon = computed(() => SETTINGS_PAGES.find((page) => page.to === route.path)?.icon);
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Home', icon: 'i-lucide-house', to: '/' }, { label: 'Settings' }]" />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <!-- Phones: the strip collapses to unreadable icons, so a labelled select stands in. -->
        <USelect
          v-model="currentPage"
          :items="selectItems"
          value-key="value"
          :icon="currentIcon"
          size="md"
          aria-label="Settings page"
          class="w-full sm:hidden"
        />
        <!-- NOTE: The `-mx-1` class is used to align with the `DashboardSidebarCollapse` button here.
             `item: shrink-0` keeps each tab at its natural width so the strip scrolls as one row
             instead of squeezing every label down to "Acc…" when the sections overflow. -->
        <UNavigationMenu
          :items="navItems"
          highlight
          class="hidden sm:flex -mx-1 flex-1"
          :ui="{ list: 'overflow-x-auto', root: 'min-w-0', item: 'shrink-0' }"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full lg:max-w-4xl mx-auto">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
