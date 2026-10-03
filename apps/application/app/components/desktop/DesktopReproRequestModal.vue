<script setup lang="ts">
/**
 * Desktop shell only: a repro request waiting for the developer. From Piwi
 * Picker, it shows the steps in words, the linked project the spec will be
 * written to and run in, and the flags; the shell renders the steps as a spec
 * under the project's test directory, runs it in the Local runs tray and
 * deletes it. From an editor, it is a job on a failure of the instance the
 * editor reads: reproduce the failing tests at their commit, or bisect between
 * the last green commit and it, in a throwaway worktree of the linked folder.
 * Nothing runs before **Run with Playwright**, **Reproduce** or **Bisect**;
 * the verdict is recorded on the request, where the sender reads it.
 */
import { reproArgs, type ReproOptions } from '#shared/desktop-repro';
import { shortCommit } from '#shared/scm-urls';
import { buildReproduceArgs } from '~/utils/local-run-args';

interface ProjectMenuItem {
  id: number;
  name: string;
  label: string | null;
}

const { current, remove } = useDesktopReproRequests();
const store = useDesktopLocalRuns();
const toast = useToast();

const open = computed({
  get: () => !!current.value,
  set: (value) => {
    if (!value && current.value) void decline();
  },
});

const { data: projects, execute: loadProjects } = useFetch('/api/projects/menu', {
  immediate: false,
  default: () => [] as ProjectMenuItem[],
  transform: (r: { items: ProjectMenuItem[] }) => r.items,
});

/** The projects linked to a folder on this machine: the only ones a spec can run in. */
const linked = ref<Array<ProjectMenuItem & { path: string }>>([]);
const loadingLinks = ref(false);
const projectId = ref<number | undefined>();
const options = ref<ReproOptions>({ headed: true, trace: true, project: null, repeatEach: 1 });
/** The Playwright project typed in the form; empty runs every project. */
const playwrightProject = ref('');
const starting = ref(false);

watch(
  () => current.value?.id,
  async (id) => {
    if (!id || !current.value) return;
    options.value = { ...current.value.options };
    playwrightProject.value = current.value.options.project ?? '';
    loadingLinks.value = true;
    try {
      if (projects.value.length === 0) await loadProjects();
      const links = await Promise.all(
        projects.value.map(async (p) => ({ project: p, link: await getDesktopProjectLink(p.id) })),
      );
      linked.value = links.flatMap(({ project, link }) => (link?.exists ? [{ ...project, path: link.path }] : []));
      if (!linked.value.some((p) => p.id === projectId.value)) projectId.value = linked.value[0]?.id;
    } finally {
      loadingLinks.value = false;
    }
  },
  { immediate: true },
);

const projectItems = computed(() => linked.value.map((p) => ({ label: p.label || p.name, value: p.id })));
const chosen = computed(() => linked.value.find((p) => p.id === projectId.value) ?? null);
const args = computed(() => reproArgs({ ...options.value, project: playwrightProject.value.trim() || null }));
const job = computed(() => current.value?.job ?? null);
const isBisect = computed(() => current.value?.kind === 'bisect');
const instanceHost = computed(() => {
  const url = current.value?.instanceUrl;
  if (!url) return 'another Piwi instance';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
});
const preview = computed(() => {
  if (!current.value) return '';
  if (job.value) {
    const test = ['npx playwright test', ...buildReproduceArgs(job.value.tests)].join(' ');
    return isBisect.value && job.value.good
      ? `git bisect start ${shortCommit(job.value.commit)} ${shortCommit(job.value.good)}\n${test}`
      : `git worktree add ${shortCommit(job.value.commit)}\n${test}`;
  }
  return ['npx playwright test', `<testDir>/piwi-repro/bug-${current.value.id}.spec.ts`, ...args.value].join(' ');
});
const title = computed(() =>
  !job.value
    ? 'Run a bug report with Playwright'
    : isBisect.value
      ? 'Find the commit that broke a test'
      : 'Reproduce a failure at its commit',
);
const expires = computed(() => (current.value ? new Date(current.value.expiresAt) : null));

async function decline() {
  const request = current.value;
  if (!request) return;
  remove(request.id);
  await $fetch(`/api/desktop/repro-requests/${request.id}`, { method: 'PATCH', body: { status: 'declined' } }).catch(
    () => {},
  );
}

async function run() {
  const request = current.value;
  const project = chosen.value;
  if (!request || !project || starting.value) return;
  starting.value = true;
  try {
    if (request.job) {
      await store.startJob({ projectId: project.id, projectLabel: project.label || project.name, request });
      remove(request.id);
      return;
    }
    if (!request.steps) return;
    await store.startRepro({
      projectId: project.id,
      projectLabel: project.label || project.name,
      requestId: request.id,
      steps: request.steps,
      args: args.value,
      bugReportId: request.bugReportId,
    });
    remove(request.id);
  } catch (error) {
    toast.add({ title: 'Could not start the run', description: errorMessage(error), color: 'error' });
    remove(request.id);
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div v-if="current" class="space-y-4">
        <p v-if="job" class="text-sm text-muted">
          Your editor asks to
          {{ isBisect ? 'find the commit that broke' : 'reproduce' }}
          <span class="font-medium text-highlighted">{{ current.title || 'a failing test' }}</span>
          from {{ instanceHost }}
          <template v-if="isBisect && job.good">
            between <code>{{ shortCommit(job.good) }}</code> (last green) and
            <code>{{ shortCommit(job.commit) }}</code> (failing)</template
          >
          <template v-else
            >at <code>{{ shortCommit(job.commit) }}</code></template
          >, in a throwaway worktree: your checkout is untouched. It runs the code of those commits on this machine, so
          start it only if you trust them. Nothing runs until you start it; the request expires at
          {{ expires?.toLocaleTimeString() }}.
        </p>
        <p v-else class="text-sm text-muted">
          Piwi Picker asks to run
          <span class="font-medium text-highlighted">{{ current.title || 'these steps' }}</span>
          in one of your projects. Nothing runs until you start it; the request expires at
          {{ expires?.toLocaleTimeString() }}.
        </p>

        <ul v-if="job" class="rounded-md border border-default p-3 max-h-48 overflow-y-auto space-y-1 text-sm">
          <li v-for="test in job.tests" :key="`${test.filePath}:${test.line}:${test.projectName}`" class="min-w-0">
            <span class="text-highlighted">{{ test.title || test.filePath }}</span>
            <code class="block text-xs text-muted break-all"
              >{{ test.filePath }}{{ test.line ? `:${test.line}` : ''
              }}{{ test.projectName ? ` (${test.projectName})` : '' }}</code
            >
          </li>
        </ul>
        <div v-else-if="current.steps" class="rounded-md border border-default p-3 max-h-64 overflow-y-auto">
          <BugReportSteps :steps="current.steps" />
        </div>

        <UAlert
          v-if="!loadingLinks && linked.length === 0"
          color="warning"
          variant="soft"
          icon="i-lucide-folder-x"
          title="No project is linked to a folder"
          description="Link a project to its checkout from its page (Run locally), then send the request again."
        />

        <template v-else>
          <UFormField
            label="Run in"
            name="project"
            :description="
              job
                ? 'A worktree of this project\'s folder runs it.'
                : 'The spec is written to this project\'s test directory.'
            "
          >
            <USelect
              v-model="projectId"
              :items="projectItems"
              :loading="loadingLinks"
              placeholder="Choose a project"
              class="w-full"
            />
          </UFormField>
          <p v-if="chosen" class="flex items-center gap-2 text-xs text-muted min-w-0">
            <UIcon name="i-lucide-folder-check" class="size-4 text-success shrink-0" />
            <code class="break-all">{{ chosen.path }}</code>
          </p>

          <div v-if="!job" class="grid grid-cols-2 gap-3">
            <UFormField label="Headed" name="headed" description="Show the browser (--headed).">
              <USwitch v-model="options.headed" />
            </UFormField>
            <UFormField label="Trace" name="trace" description="Record a trace (--trace=on).">
              <USwitch v-model="options.trace" />
            </UFormField>
            <UFormField label="Playwright project" name="playwrightProject" description="Empty runs every project.">
              <UInput v-model="playwrightProject" placeholder="chromium" class="w-full" />
            </UFormField>
            <UFormField label="Repeat" name="repeatEach" description="Run it N times (--repeat-each).">
              <UInput v-model.number="options.repeatEach" type="number" min="1" max="20" class="w-full" />
            </UFormField>
          </div>

          <div class="space-y-1">
            <div class="text-xs text-muted">
              {{
                job
                  ? 'Installs and runs at each commit in a worktree, then removes it'
                  : 'Runs in the linked folder, then the spec is deleted'
              }}
            </div>
            <CodeBlock :code="preview" lang="sh" />
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="decline">Decline</UButton>
        <UButton
          :icon="isBisect ? 'i-lucide-git-commit-horizontal' : 'i-lucide-play'"
          :disabled="!chosen"
          :loading="starting"
          @click="run"
          >{{ !job ? 'Run with Playwright' : isBisect ? 'Bisect' : 'Reproduce' }}</UButton
        >
      </div>
    </template>
  </UModal>
</template>
