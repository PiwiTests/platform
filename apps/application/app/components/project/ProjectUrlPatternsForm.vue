<script setup lang="ts">
/**
 * The project's URL patterns: the addresses its application is served at,
 * which Piwi Picker resolves the project of a page from. Suggests one pattern
 * per origin the suite already visited.
 */
import { parsePathPrefix } from '@piwitests/core/page-key';
import type { UrlPatternItem, UrlPatternSuggestion } from '#shared/handlers/url-patterns';

const props = defineProps<{ projectId: number }>();

interface Row {
  key: number;
  pattern: string;
  environment: string;
  branch: string;
  pathPrefix: string;
}

const toast = useToast();
const rows = ref<Row[]>([]);
const saved = ref('');
const suggestions = ref<UrlPatternSuggestion[]>([]);
const loading = ref(true);
const saving = ref(false);
let nextKey = 1;

const SOURCE_LABELS: Record<UrlPatternSuggestion['sources'][number], string> = {
  'base-url': 'base URL',
  'test-map': 'Test Map pages',
  'locator-pages': 'locator pages',
};

function toRows(items: UrlPatternItem[]): Row[] {
  return items.map((i) => ({
    key: nextKey++,
    pattern: i.pattern,
    environment: i.environment ?? '',
    branch: i.branch ?? '',
    pathPrefix: i.pathPrefix ?? '',
  }));
}

function snapshot(list: Row[]): string {
  return JSON.stringify(
    list.map((r) => [r.pattern.trim(), r.environment.trim(), r.branch.trim(), r.pathPrefix.trim()]),
  );
}

const dirty = computed(() => snapshot(rows.value) !== saved.value);

function patternError(pattern: string): string | undefined {
  const p = pattern.trim();
  if (!p) return 'Enter a pattern';
  if (!/^(https?:\/\/|\*)/i.test(p)) return 'Start with http://, https:// or a wildcard';
  if (rows.value.filter((r) => r.pattern.trim() === p).length > 1) return 'This pattern is listed twice';
  return undefined;
}

const PREFIX_ERRORS = {
  'query-or-hash': 'No query or hash',
  'not-a-path': 'A plain path, such as /app',
  'too-many-segments': 'At most 4 segments',
  'too-long': 'At most 200 characters',
} as const;

function prefixError(pathPrefix: string): string | undefined {
  const result = parsePathPrefix(pathPrefix);
  return result.ok ? undefined : PREFIX_ERRORS[result.problem];
}

const invalid = computed(() => rows.value.some((r) => patternError(r.pattern) || prefixError(r.pathPrefix)));

const shownSuggestions = computed(() =>
  suggestions.value.filter((s) => !rows.value.some((r) => r.pattern.trim() === s.pattern)),
);

async function load() {
  loading.value = true;
  try {
    const [list, suggested] = await Promise.all([
      $fetch<{ items: UrlPatternItem[] }>(`/api/projects/${props.projectId}/url-patterns`),
      $fetch<{ items: UrlPatternSuggestion[] }>(`/api/projects/${props.projectId}/url-patterns/suggestions`),
    ]);
    rows.value = toRows(list.items);
    saved.value = snapshot(rows.value);
    suggestions.value = suggested.items;
  } catch (error) {
    toast.add({ title: 'Couldn’t load the URL patterns', description: errorMessage(error), color: 'error' });
  } finally {
    loading.value = false;
  }
}

function addRow(pattern = '') {
  rows.value.push({ key: nextKey++, pattern, environment: '', branch: '', pathPrefix: '' });
}

function removeRow(key: number) {
  rows.value = rows.value.filter((r) => r.key !== key);
}

function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= rows.value.length) return;
  const next = [...rows.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  rows.value = next;
}

async function save() {
  if (invalid.value) return;
  saving.value = true;
  try {
    const result = await $fetch<{ items: UrlPatternItem[] }>(`/api/projects/${props.projectId}/url-patterns`, {
      method: 'PUT',
      body: {
        items: rows.value.map((r) => ({
          pattern: r.pattern.trim(),
          environment: r.environment.trim() || null,
          branch: r.branch.trim() || null,
          pathPrefix: r.pathPrefix.trim() || null,
        })),
      },
    });
    rows.value = toRows(result.items);
    saved.value = snapshot(rows.value);
    toast.add({ title: 'URL patterns saved', color: 'success' });
  } catch (error) {
    toast.add({ title: 'Couldn’t save the URL patterns', description: errorMessage(error), color: 'error' });
  } finally {
    saving.value = false;
  }
}

watch(() => props.projectId, load, { immediate: true });
</script>

<template>
  <SectionCard
    icon="i-lucide-link"
    title="Browser extension URLs"
    subtitle="Where this project’s application runs, so Piwi Picker knows which project a page belongs to"
    help="project.url-patterns"
    data-shot="project-url-patterns"
  >
    <LoadingState v-if="loading" text="Loading…" />

    <UForm v-else :state="{ rows }" class="space-y-4" @submit="save">
      <p v-if="rows.length === 0" class="text-sm text-muted">No pattern yet. Add one, or pick a suggestion below.</p>

      <ol v-else class="space-y-3">
        <li
          v-for="(row, index) in rows"
          :key="row.key"
          class="grid gap-2 rounded-lg border border-default p-3 sm:grid-cols-[1fr_8rem_8rem_7rem_auto] sm:items-start sm:border-0 sm:p-0"
          data-testid="url-pattern-row"
        >
          <UFormField :error="patternError(row.pattern)" :name="`pattern-${row.key}`">
            <UInput
              v-model="row.pattern"
              placeholder="https://staging.example.com/**"
              aria-label="URL pattern"
              class="w-full font-mono"
            />
          </UFormField>
          <UInput v-model="row.environment" placeholder="Environment" aria-label="Environment" class="w-full" />
          <UInput v-model="row.branch" placeholder="Default branch" aria-label="Branch" class="w-full font-mono" />
          <UFormField :error="prefixError(row.pathPrefix)" :name="`path-prefix-${row.key}`">
            <UInput
              v-model="row.pathPrefix"
              placeholder="Path prefix"
              aria-label="Path prefix"
              title="Your site serves the pages under this path, the tests did not, e.g. /app"
              class="w-full font-mono"
            />
          </UFormField>
          <div class="flex gap-1 justify-end">
            <UButton
              icon="i-lucide-chevron-up"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="index === 0"
              :aria-label="`Move ${row.pattern || 'this pattern'} up`"
              title="Tried earlier"
              @click="move(index, -1)"
            />
            <UButton
              icon="i-lucide-chevron-down"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="index === rows.length - 1"
              :aria-label="`Move ${row.pattern || 'this pattern'} down`"
              title="Tried later"
              @click="move(index, 1)"
            />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Remove ${row.pattern || 'this pattern'}`"
              @click="removeRow(row.key)"
            />
          </div>
        </li>
      </ol>

      <p v-if="rows.length > 0" class="text-xs text-muted" data-testid="url-pattern-prefix-hint">
        Path prefix: your site serves the pages under this path, the tests did not, e.g. /app
      </p>

      <div v-if="shownSuggestions.length > 0" class="space-y-2" data-testid="url-pattern-suggestions">
        <p class="text-sm font-semibold text-highlighted">Visited by the suite</p>
        <ul class="space-y-2">
          <li
            v-for="suggestion in shownSuggestions"
            :key="suggestion.origin"
            class="flex flex-wrap items-center justify-between gap-2"
          >
            <div class="min-w-0">
              <div class="font-mono text-sm text-highlighted break-all">{{ suggestion.pattern }}</div>
              <div class="text-xs text-muted">
                From {{ suggestion.sources.map((s) => SOURCE_LABELS[s]).join(', ') }}
              </div>
            </div>
            <UButton
              label="Add"
              color="neutral"
              variant="outline"
              size="sm"
              :aria-label="`Add ${suggestion.pattern}`"
              @click="addRow(suggestion.pattern)"
            />
          </li>
        </ul>
      </div>

      <div class="flex flex-wrap justify-between gap-2">
        <UButton label="Add a pattern" color="neutral" variant="outline" @click="addRow()" />
        <UButton
          type="submit"
          icon="i-lucide-check"
          label="Save patterns"
          :loading="saving"
          :disabled="!dirty || invalid"
        />
      </div>
    </UForm>
  </SectionCard>
</template>
