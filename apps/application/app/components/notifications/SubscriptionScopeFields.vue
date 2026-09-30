<script setup lang="ts">
/**
 * The branch and environment fields of a subscription form. Each offers the
 * names the project's runs reported and accepts a typed one, where `*` matches
 * any characters (`release/*`). An empty field matches every branch or
 * environment.
 */
const branches = defineModel<string[]>('branches', { required: true });
const environments = defineModel<string[]>('environments', { required: true });

const props = defineProps<{
  /** Branch names the project's runs reported. */
  knownBranches?: string[];
  /** Environment names the project's runs reported. */
  knownEnvironments?: string[];
}>();

const branchItems = computed(() => [...new Set([...(props.knownBranches ?? []), ...branches.value])]);
const environmentItems = computed(() => [...new Set([...(props.knownEnvironments ?? []), ...environments.value])]);

function withName(list: string[], text: string): string[] {
  const name = text.trim();
  return name && !list.includes(name) ? [...list, name] : list;
}

function addBranch(text: string) {
  branches.value = withName(branches.value, text);
}

function addEnvironment(text: string) {
  environments.value = withName(environments.value, text);
}
</script>

<template>
  <div class="space-y-2">
    <UFormField label="Branches" size="xs">
      <UInputMenu
        v-model="branches"
        :items="branchItems"
        multiple
        create-item
        placeholder="Any branch"
        size="xs"
        class="w-full"
        data-testid="subscription-branches"
        @create="addBranch"
      />
    </UFormField>
    <UFormField label="Environments" size="xs">
      <UInputMenu
        v-model="environments"
        :items="environmentItems"
        multiple
        create-item
        placeholder="Any environment"
        size="xs"
        class="w-full"
        data-testid="subscription-environments"
        @create="addEnvironment"
      />
    </UFormField>
    <p class="text-xs text-muted">
      <code>*</code> matches any characters, as in <code>release/*</code>. Applies to run and cluster events.
    </p>
  </div>
</template>
