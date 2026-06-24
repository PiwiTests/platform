<script setup lang="ts">
import { docsUrl } from '~~/shared/docs';

// Reflect the actual dashboard URL so the generated config snippet is correct
const serverUrl = ref('http://localhost:3000');
onMounted(() => {
  serverUrl.value = window.location.origin;
});

const configCode = computed(
  () => `import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@piwitests/reporter', {
      serverUrl: '${serverUrl.value}',
      projectName: 'my-project',
    }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
})`,
);

const wrapConfigCode = computed(
  () => `import { defineConfig } from '@playwright/test'
import PiwiDashboard from '@piwitests/reporter'

export default PiwiDashboard.wrapConfig(
  defineConfig({
    // your existing config
    use: {
      trace: 'retain-on-failure',
    },
  }),
  {
    serverUrl: '${serverUrl.value}',
    projectName: 'my-project',
  },
)`,
);

const fixturesExtendCode = `// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { dashboardFixtures } from '@piwitests/reporter/fixtures'

export const test = base.extend(dashboardFixtures)
export { expect }`;

const fixturesUseCode = `// your test file
import { test, expect } from './fixtures'

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  // network requests, web vitals, console errors, and ARIA snapshots
  // are captured automatically and appear in the dashboard
})`;

const fixturesDropInCode = `import { test, expect } from '@piwitests/reporter/fixtures'`;

const steps = computed(() => [
  {
    id: 1,
    title: 'Start the dashboard',
    description: "You're already here — the dashboard is running.",
    done: true,
    code: null as string | null,
    lang: undefined as string | undefined,
  },
  {
    id: 2,
    title: 'Install the reporter',
    description: 'Add the Piwi reporter to your Playwright project.',
    done: false,
    code: 'npm install --save-dev @piwitests/reporter',
    lang: 'bash',
  },
  {
    id: 3,
    title: 'Configure Playwright',
    description: 'Add the reporter to your playwright.config.ts.',
    done: false,
    code: configCode.value,
    lang: 'typescript',
  },
  {
    id: 4,
    title: 'Run your tests',
    description: 'Results appear in the dashboard automatically. The project is created on first submit.',
    done: false,
    code: 'npx playwright test',
    lang: 'bash',
  },
]);

const goFurtherOpen = ref(false);
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="p-2 bg-primary/10 rounded-lg shrink-0">
          <UIcon name="i-lucide-rocket" class="size-5 text-primary" />
        </div>
        <div>
          <h2 class="text-xl font-semibold inline-flex items-center gap-1">
            Get started in 60 seconds <HelpHint topic="home.get-started" />
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">Send your first test run in four steps</p>
        </div>
      </div>
    </template>

    <div>
      <div v-for="(step, index) in steps" :key="step.id" class="flex gap-4">
        <!-- Step indicator + vertical connector -->
        <div class="flex flex-col items-center shrink-0">
          <div
            class="flex size-8 items-center justify-center rounded-full text-sm font-semibold"
            :class="
              step.done
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-primary/10 text-primary'
            "
          >
            <UIcon v-if="step.done" name="i-lucide-check" class="size-4" />
            <span v-else>{{ step.id }}</span>
          </div>
          <div v-if="index < steps.length - 1" class="w-px flex-1 mt-2 min-h-6 bg-gray-200 dark:bg-gray-700" />
        </div>

        <!-- Step content -->
        <div class="flex-1 pb-6">
          <div class="flex items-center gap-2 mb-1">
            <h3 class="font-medium">{{ step.title }}</h3>
            <UBadge v-if="step.done" color="success" variant="subtle" size="xs">Done</UBadge>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">{{ step.description }}</p>
          <CodeBlock v-if="step.code" :code="step.code" :lang="step.lang" />
        </div>
      </div>

      <!-- Go further (collapsible) -->
      <div class="border-t border-gray-200 dark:border-gray-700 pt-4 mt-2">
        <button
          class="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-primary transition-colors w-full text-left"
          @click="goFurtherOpen = !goFurtherOpen"
        >
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 transition-transform duration-200"
            :class="goFurtherOpen ? 'rotate-90' : ''"
          />
          Go further — simpler config &amp; performance metrics
        </button>

        <div v-if="goFurtherOpen" class="mt-4 space-y-6">
          <!-- wrapConfig -->
          <div>
            <h4 class="font-medium text-sm mb-1">
              Simpler config with <code class="text-primary text-xs">wrapConfig</code>
            </h4>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Instead of manually adding the reporter array entry,
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">wrapConfig</code>
              auto-injects the reporter and chains the global setup in one call. It also registers the run on the
              dashboard <em>before</em> your
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">globalSetup</code> runs, so the
              dashboard shows an initialising state during setup.
            </p>
            <CodeBlock :code="wrapConfigCode" lang="typescript" />
          </div>

          <!-- dashboardFixtures -->
          <div>
            <h4 class="font-medium text-sm mb-1">
              Network requests, Web Vitals &amp; console with
              <code class="text-primary text-xs">dashboardFixtures</code>
            </h4>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Extend your Playwright
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">test</code> with
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">dashboardFixtures</code> to
              automatically capture network timing, browser Web Vitals, console errors, and ARIA snapshots on failure.
            </p>

            <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
              Option A — extend your existing fixtures
            </p>
            <CodeBlock :code="fixturesExtendCode" lang="typescript" class="mb-3" />
            <CodeBlock :code="fixturesUseCode" lang="typescript" class="mb-4" />

            <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
              Option B — drop-in replacement
            </p>
            <CodeBlock :code="fixturesDropInCode" lang="typescript" />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span
          >Need more options? See the
          <DocLink to="reporter" no-icon class="text-primary hover:underline">full reporter docs</DocLink>.</span
        >
        <UButton
          :to="docsUrl('demo/')"
          target="_blank"
          variant="ghost"
          size="sm"
          color="neutral"
          trailing-icon="i-lucide-external-link"
        >
          View demo with sample data
        </UButton>
      </div>
    </template>
  </UCard>
</template>
