<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

useHead({ title: 'Settings — Playwright Dashboard' })

/*
{
  label: 'General',
  icon: 'i-lucide-user',
  to: '/settings',
  exact: true
},
 */

const links = [[{
  label: 'Users',
  icon: 'i-lucide-users',
  to: '/settings/users'
}, {
  label: 'Tags',
  icon: 'i-lucide-tags',
  to: '/settings/tags'
}, {
  label: 'Storage',
  icon: 'i-lucide-hard-drive',
  to: '/settings/storage'
}], [{
  label: 'Documentation',
  icon: 'i-lucide-book-open',
  to: 'https://github.com/PhenX/playwright-dashboard',
  target: '_blank'
}]] satisfies NavigationMenuItem[][]
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <UBreadcrumb :items="[{ label: 'Home', icon: 'i-lucide-house', to: '/' }, { label: 'Settings' }]" />
      </UDashboardNavbar>

      <UDashboardToolbar>
        <!-- NOTE: The `-mx-1` class is used to align with the `DashboardSidebarCollapse` button here. -->
        <UNavigationMenu :items="links" highlight class="-mx-1 flex-1" />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full lg:max-w-2xl mx-auto">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
