<script setup lang="ts">
/**
 * Check pasted locators against the project's locator index: one per line as
 * the Piwi Picker extension copies them ("Copy all"), or lines of test code.
 * Each locator reads as used exactly, through the same target call in other
 * containers, through a call that finds the same element, or as a container
 * other chains search inside — and the tests reaching any of them are listed
 * once, which answers "is this element tested, and by what?".
 */
import {
  extractLocatorExpressions,
  lookupLocators,
  type LocatorIndex,
  type LocatorLookup,
  type LocatorMatchKind,
} from '#shared/locator-index';

const props = defineProps<{
  index: LocatorIndex;
  modelValue: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; inspect: [locator: string] }>();

const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
});

const extracted = computed(() => extractLocatorExpressions(props.modelValue));
const lookups = computed(() => lookupLocators(props.index, extracted.value));
const readable = computed(() => lookups.value.filter((l) => l.locator));
const usedExactly = computed(() => readable.value.filter((l) => l.hits.some((h) => h.kind === 'exact')).length);

/** The tests reaching any pasted locator, with the pasted locators they reach it through. */
const reachingTests = computed(() => {
  const byTest = new Map<number, Set<string>>();
  for (const lookup of readable.value) {
    for (const test of lookup.tests) {
      let via = byTest.get(test);
      if (!via) byTest.set(test, (via = new Set()));
      via.add(lookup.locator!);
    }
  }
  return [...byTest.entries()]
    .map(([test, via]) => ({ test: props.index.tests[test]!, via: [...via] }))
    .sort((a, b) => b.via.length - a.via.length || a.test.title.localeCompare(b.test.title));
});

const KIND_LABELS: Record<LocatorMatchKind, string> = {
  exact: 'This locator',
  target: 'Same target, other containers',
  similar: 'Another call that finds the same element',
  scope: 'Searched inside it',
};

function verdict(lookup: LocatorLookup): string {
  if (!lookup.locator) return 'Not a locator this page can read';
  const testsOf = (kind: LocatorMatchKind) =>
    new Set(lookup.hits.filter((h) => h.kind === kind).flatMap((h) => h.tests)).size;
  const tests = (n: number) => `${n} ${n === 1 ? 'test' : 'tests'}`;
  if (testsOf('exact')) return `Used by ${tests(testsOf('exact'))}`;
  if (testsOf('target')) return `Same target in ${tests(testsOf('target'))}`;
  if (testsOf('similar')) return `A similar locator in ${tests(testsOf('similar'))}`;
  if (testsOf('scope')) return `A container in ${tests(testsOf('scope'))}`;
  return 'Not used by any test';
}

const HITS_SHOWN = 6;
const TESTS_SHOWN = 5;
const open = ref(new Set<string>());
function toggle(key: string) {
  const next = new Set(open.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  open.value = next;
}

function statusDot(status: string | null): string {
  return statusPalette(status).bg;
}
</script>

<template>
  <div class="space-y-4" data-shot="locator-check">
    <UTextarea
      v-model="text"
      :rows="4"
      autoresize
      :maxrows="14"
      class="w-full"
      :ui="{ base: 'font-mono text-sm' }"
      placeholder="getByRole('button', { name: 'Pay now' })&#10;getByTestId('pay')&#10;await page.getByLabel('Card number').fill('4242…')"
      aria-label="Locators to check"
    />

    <p v-if="!modelValue.trim()" class="text-sm text-muted">
      Paste locators, one per line — the Piwi Picker extension's <span class="font-medium">Copy all</span> gives exactly
      that — or lines of test code.
    </p>
    <p v-else-if="lookups.length === 0" class="text-sm text-muted">No locator found in this text.</p>

    <template v-else>
      <p class="text-sm text-highlighted leading-relaxed">
        <template v-if="reachingTests.length">
          <span class="tabular-nums">{{ usedExactly }}</span> of
          <span class="tabular-nums">{{ readable.length }}</span>
          {{ readable.length === 1 ? 'locator is' : 'locators are' }} used as written.
          <span class="tabular-nums">{{ reachingTests.length }}</span>
          {{ reachingTests.length === 1 ? 'test reaches' : 'tests reach' }} at least one of them, exactly or through a
          close match.
        </template>
        <template v-else>No test of this project uses these locators, or anything close to them.</template>
      </p>

      <ul class="divide-y divide-default border-y border-default">
        <li v-for="(lookup, i) in lookups" :key="`${i}|${lookup.input}`" class="py-3 space-y-2">
          <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div class="min-w-0 space-y-1">
              <p class="text-xs font-medium text-muted" data-verdict>{{ verdict(lookup) }}</p>
              <LocatorCode v-if="lookup.locator" :locator="lookup.locator" class="text-sm" />
              <code v-else class="font-mono text-sm break-words text-muted">{{ lookup.input }}</code>
            </div>
            <UButton
              v-if="lookup.hits.length"
              color="neutral"
              variant="ghost"
              size="xs"
              class="self-start shrink-0"
              :trailing-icon="open.has(`${i}`) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-expanded="open.has(`${i}`) ? 'true' : 'false'"
              @click="toggle(`${i}`)"
            >
              {{ lookup.hits.length }} {{ lookup.hits.length === 1 ? 'match' : 'matches' }}
            </UButton>
          </div>

          <ul v-if="open.has(`${i}`)" class="space-y-3 pl-3 border-l border-default">
            <li v-for="hit in lookup.hits.slice(0, HITS_SHOWN)" :key="hit.locator" class="space-y-1">
              <p class="text-xs font-medium text-muted">{{ KIND_LABELS[hit.kind] }}</p>
              <LocatorCode :locator="hit.locator" class="text-sm" />
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                <span>{{ hit.tests.length }} {{ hit.tests.length === 1 ? 'test' : 'tests' }}</span>
                <span v-if="hit.actions.length">{{ hit.actions.map(locatorActionLabel).join(', ') }}</span>
                <button type="button" :class="SENTENCE_LINK_CLASS" @click="emit('inspect', hit.locator)">
                  Who uses this?
                </button>
              </div>
              <ul class="text-sm space-y-0.5">
                <li v-for="t in hit.tests.slice(0, TESTS_SHOWN)" :key="t" class="min-w-0 flex items-center gap-2">
                  <span class="size-2 rounded-full shrink-0" :class="statusDot(index.tests[t]!.status)" />
                  <NuxtLink
                    :to="`/test-cases/${index.tests[t]!.id}`"
                    class="truncate"
                    :class="SENTENCE_LINK_CLASS"
                    :title="index.tests[t]!.file"
                  >
                    {{ [...index.tests[t]!.suite, index.tests[t]!.title].join(' › ') }}
                  </NuxtLink>
                </li>
              </ul>
              <p v-if="hit.tests.length > TESTS_SHOWN" class="text-xs text-muted">
                {{ hit.tests.length - TESTS_SHOWN }} more
              </p>
            </li>
            <li v-if="lookup.hits.length > HITS_SHOWN" class="text-xs text-muted">
              {{ lookup.hits.length - HITS_SHOWN }} more matches
            </li>
          </ul>
        </li>
      </ul>

      <div v-if="reachingTests.length" class="space-y-2" data-shot="locator-check-tests">
        <p class="text-xs font-medium text-muted">Tests reaching these locators ({{ reachingTests.length }})</p>
        <ul class="space-y-1.5">
          <li v-for="row in reachingTests" :key="row.test.id" class="min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <span class="size-2 rounded-full shrink-0" :class="statusDot(row.test.status)" />
              <NuxtLink
                :to="`/test-cases/${row.test.id}`"
                class="text-sm truncate"
                :class="SENTENCE_LINK_CLASS"
                :title="row.test.file"
              >
                {{ [...row.test.suite, row.test.title].join(' › ') }}
              </NuxtLink>
            </div>
            <p class="text-xs text-muted pl-4 break-words">
              {{ row.test.file }} · through {{ row.via.length }} of the pasted
              {{ row.via.length === 1 ? 'locator' : 'locators' }}
            </p>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
