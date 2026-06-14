<script setup lang="ts">
const config = useRuntimeConfig();
const colorMode = useColorMode();

const color = computed(() => (colorMode.value === 'dark' ? '#1b1718' : 'white'));
// Prepend the app base URL so the favicon resolves correctly in demo mode
// (where baseURL is /piwi-dashboard/demo/) and in normal mode (where it is /).
const iconHref = (config.app?.baseURL ?? '/').replace(/\/$/, '') + '/logo.svg';

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color },
  ],
  link: [{ rel: 'icon', type: 'image/svg+xml', href: iconHref }],
  htmlAttrs: {
    lang: 'en',
  },
});

const title = 'Piwi Dashboard';
const description = 'The Piwi Dashboard with statistics and test management.';

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image',
});
</script>

<template>
  <UApp>
    <DemoInitScreen />
    <NuxtLoadingIndicator />
    <DemoBanner />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
