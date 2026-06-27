<script setup lang="ts">
const config = useRuntimeConfig();
const isDemo = config.public.demoMode;
const specUrl = isDemo ? '/demo/_openapi.json' : '/_openapi.json';
const container = ref<HTMLDivElement>();

useHead({
  title: 'API Reference — Piwi Dashboard',
});

onMounted(async () => {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
  script.async = true;
  script.onload = () => {
    const S = (window as unknown as Record<string, unknown>).Scalar as
      | { createApiReference: (element: HTMLElement, config: Record<string, unknown>) => void }
      | undefined;
    if (S?.createApiReference && container.value) {
      S.createApiReference(container.value, {
        url: specUrl,
        darkMode: true,
        showSidebar: true,
        metaData: {
          title: 'Piwi Dashboard API',
          description:
            'REST API for storing and querying Playwright test results, traces, failure diagnoses, and project statistics.',
        },
      });
    }
  };
  document.head.appendChild(script);
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
.scalar-container :deep(.scalar-app) {
  min-height: 100vh;
}
</style>
