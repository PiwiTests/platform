<script setup lang="ts">
const config = useRuntimeConfig();
const isDemo = config.public.demoMode;
const specUrl = isDemo ? '/demo/_openapi.json' : '/_openapi.json';
const container = ref<HTMLDivElement>();

useHead({
  title: 'API Reference — Piwi Dashboard',
});

onMounted(async () => {
  const { createScalarApiReference } =
    await import('https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.js');
  createScalarApiReference(
    {
      url: specUrl,
      darkMode: true,
      showSidebar: true,
      metaData: {
        title: 'Piwi Dashboard API',
        description:
          'REST API for storing and querying Playwright test results, traces, failure diagnoses, and project statistics.',
      },
    },
    container.value!,
  );
});
</script>

<template>
  <ClientOnly>
    <div ref="container" class="scalar-container" />
    <template #fallback>
      <div class="flex items-center justify-center h-screen text-gray-400">Loading API reference...</div>
    </template>
  </ClientOnly>
</template>

<style>
.scalar-container {
  height: 100vh;
  width: 100%;
}
</style>
