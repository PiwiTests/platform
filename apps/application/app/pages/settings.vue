<script setup lang="ts">
useHead({ title: 'Settings — Piwi Dashboard' });

const { envManaged } = useSettingsEnvState();

// Already grouped (Instance / Analysis / meta) and rendered as the tab bar.
// Documentation is not a settings page — it lives in Settings → About →
// Resources and behind every inline-help "Learn more" link.
const navItems = await useSettingsNav(envManaged);
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
        <!-- NOTE: The `-mx-1` class is used to align with the `DashboardSidebarCollapse` button here. -->
        <UNavigationMenu
          :items="navItems"
          highlight
          class="-mx-1 flex-1"
          :ui="{ list: 'overflow-x-auto', root: 'min-w-0' }"
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
