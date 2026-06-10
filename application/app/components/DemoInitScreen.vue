<script setup lang="ts">
const config = useRuntimeConfig()
const demoReady = useState('demoReady', () => false)

const isDemo = config.public.demoMode
const showLoading = computed(() => isDemo && !demoReady.value)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="showLoading"
      class="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white dark:bg-gray-950 transition-opacity duration-500"
    >
      <svg
        class="w-12 h-12 text-gray-400 animate-spin mb-4"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <p class="text-sm text-gray-500">Initializing demo database…</p>
    </div>
  </Teleport>
</template>
