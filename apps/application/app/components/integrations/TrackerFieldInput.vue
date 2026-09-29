<script setup lang="ts">
/**
 * The input for one tracker field, chosen by its kind: a pick-list for the
 * values Jira lists, a user search, text, a number, a date, an issue key, or a
 * raw API value for the types Jira gives no list for (a team, a sprint). It
 * edits a {@link FieldValue} — the value as Jira's API takes it plus a label to
 * show it back — and emits null when cleared.
 */
import { parseRawFieldValue, textToDocument, type FieldValue, type TrackerField } from '#shared/integrations/fields';
import type { TrackerUserOption } from '#shared/integrations/types';

const props = defineProps<{
  field: TrackerField;
  /** For a user field: the connection and project to search assignable people in. */
  connectionId?: number | null;
  projectKey?: string | null;
}>();

const model = defineModel<FieldValue | null | undefined>();

function set(value: unknown, label: string) {
  model.value = value == null || label === '' ? null : { value, label };
}

const optionItems = computed(() => (props.field.options ?? []).map((o) => ({ label: o.label, value: o.id })));
const labelOf = (id: string) => props.field.options?.find((o) => o.id === id)?.label ?? id;

// ── Pick-lists ───────────────────────────────────────────────────────────────
const optionId = computed({
  get: () => ((model.value?.value as { id?: string } | null)?.id ?? undefined) as string | undefined,
  set: (id) => (id ? set({ id }, labelOf(id)) : set(null, '')),
});
const optionIds = computed({
  get: () => ((model.value?.value as Array<{ id?: string }> | null) ?? []).map((v) => v.id).filter(Boolean) as string[],
  set: (ids: string[]) =>
    ids.length
      ? set(
          ids.map((id) => ({ id })),
          ids.map(labelOf).join(', '),
        )
      : set(null, ''),
});

// ── Text-like values: the label is what was typed ──────────────────────────────
const text = computed({
  get: () => model.value?.label ?? '',
  set: (raw: string) => {
    const value = raw ?? '';
    if (!value.trim()) return set(null, '');
    switch (props.field.kind) {
      case 'text':
        return set(textToDocument(value), value);
      case 'number': {
        const n = Number(value);
        return Number.isFinite(n) ? set(n, value) : set(null, '');
      }
      case 'datetime': {
        const at = new Date(value);
        return Number.isNaN(at.getTime()) ? set(null, '') : set(at.toISOString().replace('Z', '+0000'), value);
      }
      case 'issue':
        return set({ key: value.trim().toUpperCase() }, value.trim().toUpperCase());
      case 'raw':
        return set(parseRawFieldValue(value), value.trim());
      default:
        return set(value, value);
    }
  },
});

const tags = computed({
  get: () => (Array.isArray(model.value?.value) ? (model.value!.value as string[]) : []),
  set: (list: string[]) => (list.length ? set(list, list.join(', ')) : set(null, '')),
});

// ── People, searched among the project's assignable users ─────────────────────
const people = ref<TrackerUserOption[]>([]);
const peopleItems = computed(() => {
  const items = people.value.map((u) => ({ label: u.displayName || u.id, value: u.id }));
  // Keep the chosen people listed even before a search brings them back.
  const chosen = selectedPeople.value.filter((id) => !items.some((i) => i.value === id));
  const labels = (model.value?.label ?? '').split(', ');
  return [...chosen.map((id, i) => ({ label: labels[i] || id, value: id })), ...items];
});
const selectedPeople = computed(() => {
  const v = model.value?.value;
  if (Array.isArray(v)) return v.map((u) => (u as { accountId?: string }).accountId).filter(Boolean) as string[];
  const one = (v as { accountId?: string } | null)?.accountId;
  return one ? [one] : [];
});
const personLabel = (id: string) => peopleItems.value.find((i) => i.value === id)?.label ?? id;
const person = computed({
  get: () => selectedPeople.value[0],
  set: (id: string | undefined) => (id ? set({ accountId: id }, personLabel(id)) : set(null, '')),
});
const persons = computed({
  get: () => selectedPeople.value,
  set: (ids: string[]) =>
    ids.length
      ? set(
          ids.map((id) => ({ accountId: id })),
          ids.map(personLabel).join(', '),
        )
      : set(null, ''),
});

async function searchPeople(query = '') {
  if (!props.connectionId || !props.projectKey) return;
  try {
    const params = new URLSearchParams({ project: props.projectKey, q: query });
    const res = await $fetch<{ users: TrackerUserOption[] }>(
      `/api/integrations/connections/${props.connectionId}/assignable?${params.toString()}`,
    );
    people.value = res.users;
  } catch {
    people.value = [];
  }
}

/** Where a raw value comes from, for the types people meet most; else the plain API value. */
const RAW_PLACEHOLDERS: Record<string, string> = {
  'atlassian-team': 'Team id, from its page URL',
  'gh-sprint': 'Sprint id (a number)',
  'gh-epic-link': 'Epic key, e.g. PROJ-12',
};
const rawPlaceholder = computed(() => RAW_PLACEHOLDERS[props.field.typeName] ?? "Jira's API value");
</script>

<template>
  <USelectMenu
    v-if="field.kind === 'option'"
    v-model="optionId"
    :items="optionItems"
    value-key="value"
    placeholder="Choose a value"
    class="w-full"
  />
  <USelectMenu
    v-else-if="field.kind === 'option-array'"
    v-model="optionIds"
    :items="optionItems"
    value-key="value"
    multiple
    placeholder="Choose values"
    class="w-full"
  />
  <USelectMenu
    v-else-if="field.kind === 'user'"
    v-model="person"
    :items="peopleItems"
    value-key="value"
    searchable
    placeholder="Search a person"
    class="w-full"
    @update:open="(isOpen: boolean) => isOpen && searchPeople()"
    @update:search-term="(q: string) => searchPeople(q)"
  />
  <USelectMenu
    v-else-if="field.kind === 'user-array'"
    v-model="persons"
    :items="peopleItems"
    value-key="value"
    multiple
    searchable
    placeholder="Search people"
    class="w-full"
    @update:open="(isOpen: boolean) => isOpen && searchPeople()"
    @update:search-term="(q: string) => searchPeople(q)"
  />
  <UInputMenu
    v-else-if="field.kind === 'string-array'"
    v-model="tags"
    :items="tags"
    multiple
    create-item
    placeholder="Add values"
    class="w-full"
  />
  <UTextarea v-else-if="field.kind === 'text'" v-model="text" :rows="2" autoresize class="w-full" />
  <UInput v-else-if="field.kind === 'number'" v-model="text" type="number" class="w-full" />
  <UInput v-else-if="field.kind === 'date'" v-model="text" type="date" class="w-full" />
  <UInput v-else-if="field.kind === 'datetime'" v-model="text" type="datetime-local" class="w-full" />
  <UInput v-else-if="field.kind === 'issue'" v-model="text" placeholder="Issue key, e.g. PROJ-42" class="w-full" />
  <UInput
    v-else
    v-model="text"
    :placeholder="field.kind === 'raw' ? rawPlaceholder : ''"
    :class="field.kind === 'raw' ? 'w-full font-mono' : 'w-full'"
  />
</template>
