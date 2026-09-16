<script setup lang="ts">
const props = defineProps<{
  /**
   * API path of the offline-report endpoint, e.g. `/api/failure-clusters/12/export`.
   * Omit it (as on the run page) to offer only the Perfetto trace.
   */
  endpoint?: string;
  /** API path of the Perfetto trace endpoint, e.g. `/api/test-runs/12/perfetto`. */
  perfettoEndpoint?: string;
  /** Used only for the desktop shell's fallback filename; the server names the file. */
  baseName: string;
}>();

const { download } = useDesktopDownload();
const { copy } = useCopy();
const toast = useToast();
const open = ref(false);
const busy = ref('');

/**
 * These URLs are opened or fetched directly rather than going through `$fetch`,
 * so the app's base path has to be applied by hand — the demo is served from
 * `/demo/` and its service worker only intercepts requests under that prefix. A
 * root-relative `/api/...` would escape the scope entirely and 404.
 */
const base = computed(() => (useRuntimeConfig().app?.baseURL ?? '/').replace(/\/$/, ''));

function withBase(path: string): string {
  return `${base.value}${path}`;
}

async function run(format: 'html' | 'zip' | 'pdf' | 'json' | 'md') {
  open.value = false;
  // ZIP and PDF are the binary formats; the rest are text the shell writes directly.
  await download(withBase(`${props.endpoint}?format=${format}`), `${props.baseName}.${format}`, {
    binary: format === 'zip' || format === 'pdf',
  });
}

/** The Perfetto trace is a JSON file that opens at ui.perfetto.dev. */
async function runPerfetto() {
  open.value = false;
  if (!props.perfettoEndpoint) return;
  await download(withBase(props.perfettoEndpoint), `${props.baseName}-perfetto.json`, { binary: false });
}

/**
 * The clipboard actions read the same endpoints the downloads do, so copying
 * and downloading can never describe the investigation differently.
 */
async function copyFrom(path: string, label: string, pick?: (text: string) => string) {
  busy.value = label;
  try {
    const response = await fetch(withBase(path));
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const text = await response.text();
    copy(pick ? pick(text) : text, { toast: `${label} copied` });
    open.value = false;
  } catch (error) {
    toast.add({ title: `Could not copy ${label.toLowerCase()}`, description: errorMessage(error), color: 'error' });
  } finally {
    busy.value = '';
  }
}

function copyReport() {
  return copyFrom(`${props.endpoint}?format=md`, 'Report');
}
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      icon="i-lucide-share"
      size="xs"
      color="neutral"
      variant="outline"
      title="Take this investigation away"
      aria-label="Export"
    >
      <span class="hidden xl:inline">Export</span>
    </UButton>

    <template #content>
      <div class="w-64 p-1 space-y-0.5">
        <template v-if="endpoint">
          <div class="flex items-center justify-between px-2 pt-1 pb-1">
            <p class="text-xs font-medium text-gray-500">Download</p>
            <HelpHint topic="export.offline" />
          </div>

          <UButton
            block
            size="sm"
            color="neutral"
            variant="ghost"
            class="justify-start"
            icon="i-lucide-file-code"
            title="One self-contained HTML file with screenshots and video embedded"
            @click="run('html')"
          >
            HTML — single file
          </UButton>

          <UButton
            block
            size="sm"
            color="neutral"
            variant="ghost"
            class="justify-start"
            icon="i-lucide-file-archive"
            title="Report plus the raw artifacts, including trace archives and data.json"
            @click="run('zip')"
          >
            ZIP — with all evidence
          </UButton>

          <UButton
            block
            size="sm"
            color="neutral"
            variant="ghost"
            class="justify-start"
            icon="i-lucide-file-down"
            title="A formatted PDF with screenshots embedded — generated directly, no browser print needed"
            @click="run('pdf')"
          >
            PDF — formatted document
          </UButton>

          <UButton
            block
            size="sm"
            color="neutral"
            variant="ghost"
            class="justify-start"
            icon="i-lucide-file-text"
            title="The Markdown report as a file"
            @click="run('md')"
          >
            Markdown
          </UButton>

          <UButton
            block
            size="sm"
            color="neutral"
            variant="ghost"
            class="justify-start"
            icon="i-lucide-file-json"
            title="Everything the report contains, machine-readable"
            @click="run('json')"
          >
            JSON
          </UButton>
        </template>

        <template v-if="perfettoEndpoint">
          <USeparator v-if="endpoint" class="my-1" />
          <p class="text-xs font-medium text-gray-500 px-2 pt-1 pb-1">Timeline</p>

          <UButton
            block
            size="sm"
            color="neutral"
            variant="ghost"
            class="justify-start"
            icon="i-lucide-activity"
            title="A Trace Event Format file — opens at ui.perfetto.dev or chrome://tracing"
            @click="runPerfetto"
          >
            <span class="flex flex-col items-start text-left leading-tight">
              Perfetto trace
              <span class="text-xs text-gray-500">Opens at ui.perfetto.dev</span>
            </span>
          </UButton>
        </template>

        <template v-if="endpoint">
          <USeparator class="my-1" />
          <p class="text-xs font-medium text-gray-500 px-2 pt-1 pb-1">Copy to clipboard</p>

          <UButton
            block
            size="sm"
            color="neutral"
            variant="ghost"
            class="justify-start"
            icon="i-lucide-clipboard-list"
            :loading="busy === 'Report'"
            title="The whole investigation as Markdown, for an issue or a chat"
            @click="copyReport"
          >
            Report (Markdown)
          </UButton>
        </template>
      </div>
    </template>
  </UPopover>
</template>
