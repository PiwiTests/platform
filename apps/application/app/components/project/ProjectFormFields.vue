<script setup lang="ts">
/**
 * Shared field set for the project create + edit forms so the two never drift.
 * Render inside a `<UForm>` (the parent owns the schema, submit and footer).
 *
 * The field set is API-driven and gated by `mode`:
 * - `create` shows the immutable `name` (POST /api/projects only accepts
 *   name/label/description/tags).
 * - `edit` shows `diagnosisInstructions` + `scmToken` (PUT /api/projects/[id]
 *   only; the SCM token is encrypted against an existing project).
 * Shared in both: label, description, tags.
 */
import type { TagInfo } from '~~/types/api';

withDefaults(
  defineProps<{
    mode: 'create' | 'edit';
    allTags: TagInfo[];
    /** Edit mode: whether a SCM token is already stored (adjusts placeholder/help). */
    hasToken?: boolean;
  }>(),
  { hasToken: false },
);

const emit = defineEmits<{ 'tag-created': [] }>();

const name = defineModel<string>('name', { default: '' });
const label = defineModel<string>('label', { default: '' });
const description = defineModel<string>('description', { default: '' });
const diagnosisInstructions = defineModel<string>('diagnosisInstructions', { default: '' });
const aiLanguage = defineModel<string>('aiLanguage', { default: '' });
const scmToken = defineModel<string>('scmToken', { default: '' });
const defaultBranch = defineModel<string>('defaultBranch', { default: '' });
const openApiUrl = defineModel<string>('openApiUrl', { default: '' });
const tags = defineModel<TagInfo[]>('tags', { default: () => [] });

/** Full-shape CI re-run form state — the server drops empty targets on save. */
export interface CiRerunForm {
  enabled: boolean;
  github: { workflow: string; ref: string; inputName: string };
  gitlab: { ref: string; variableName: string };
  bitbucket: { pipeline: string; variableName: string };
}
const ciRerun = defineModel<CiRerunForm>('ciRerun', {
  default: () => ({
    enabled: false,
    github: { workflow: '', ref: '', inputName: '' },
    gitlab: { ref: '', variableName: '' },
    bitbucket: { pipeline: '', variableName: '' },
  }),
});
</script>

<template>
  <div class="space-y-5">
    <UFormField
      v-if="mode === 'create'"
      label="Project name"
      name="name"
      required
      description="A unique identifier used to match test results from the reporter."
    >
      <UInput v-model="name" placeholder="e.g. my-app" class="w-full" />
    </UFormField>

    <UFormField
      label="Display label"
      name="label"
      description="A friendly name shown in the UI (defaults to project name if not set)."
    >
      <UInput v-model="label" placeholder="e.g. My Application" class="w-full" />
    </UFormField>

    <UFormField label="Description" name="description" description="Optional description of this project.">
      <UTextarea v-model="description" placeholder="Enter project description" :rows="3" class="w-full" />
    </UFormField>

    <template v-if="mode === 'edit'">
      <UFormField name="diagnosisInstructions" description="Combined with the global instructions from Settings → AI.">
        <template #label>
          <span class="inline-flex items-center gap-1">
            AI diagnosis instructions <HelpHint topic="project.ai-instructions" />
          </span>
        </template>
        <UTextarea
          v-model="diagnosisInstructions"
          placeholder="e.g. This project tests the payment checkout flow. The backend uses Stripe for payments and the payment API is at /api/v2/payments. Database errors are usually caused by connection pool exhaustion under load."
          :rows="5"
          class="w-full font-mono text-sm"
        />
      </UFormField>

      <UFormField
        name="aiLanguage"
        label="AI response language"
        description="Overrides Settings → AI for this project. Blank inherits the instance-wide language. Code, locators, paths and error text stay verbatim."
      >
        <UInput v-model="aiLanguage" placeholder="e.g. French — blank inherits the global setting" class="w-full" />
      </UFormField>

      <UFormField
        name="scmToken"
        :description="
          hasToken
            ? 'Leave empty to keep the stored token, enter a new value to replace it, or save empty to remove it'
            : 'For GitHub, GitLab, or Bitbucket. Falls back to the global SCM token if not set.'
        "
      >
        <template #label>
          <span class="inline-flex items-center gap-1">SCM token <HelpHint topic="project.scm-token" /></span>
        </template>
        <UInput
          v-model="scmToken"
          type="password"
          :placeholder="hasToken ? '•••••••• (unchanged)' : 'ghp_..., glpat-..., or bitbucket token'"
          class="w-full font-mono"
        />
      </UFormField>

      <UFormField
        label="Default branch"
        name="defaultBranch"
        description="Baselines, flakiness and trends fall back to this branch. Leave empty to resolve it from the SCM provider (else 'main')."
      >
        <UInput v-model="defaultBranch" placeholder="e.g. main" class="w-full font-mono" />
      </UFormField>

      <UFormField
        label="OpenAPI document URL"
        name="openApiUrl"
        description="Declared surface. Fetched server-side; its routes and documented response codes become declared graph nodes, so a route the spec documents but no test reaches is a gap. Leave empty to skip."
      >
        <UInput v-model="openApiUrl" placeholder="e.g. https://app.example.com/openapi.json" class="w-full font-mono" />
      </UFormField>

      <UFormField
        name="ciRerun"
        description="Let reporters and admins re-run a cluster's affected tests in CI from its page, using the SCM token above. Off by default; fill in the block for your provider."
      >
        <template #label>
          <span class="inline-flex items-center gap-1">CI re-run <HelpHint topic="project.ci-rerun" /></span>
        </template>
        <div class="space-y-3">
          <USwitch v-model="ciRerun.enabled" label="Enable re-run from the dashboard" />
          <div v-if="ciRerun.enabled" class="space-y-4 rounded-md border border-default p-3">
            <div class="space-y-2">
              <p class="text-xs font-medium text-muted">GitHub — workflow_dispatch</p>
              <div class="grid gap-2 sm:grid-cols-3">
                <UInput v-model="ciRerun.github.workflow" placeholder="workflow file, e.g. e2e.yml" class="font-mono" />
                <UInput v-model="ciRerun.github.ref" placeholder="ref, e.g. main" class="font-mono" />
                <UInput v-model="ciRerun.github.inputName" placeholder="input name, e.g. args" class="font-mono" />
              </div>
            </div>
            <div class="space-y-2">
              <p class="text-xs font-medium text-muted">GitLab — pipeline</p>
              <div class="grid gap-2 sm:grid-cols-2">
                <UInput v-model="ciRerun.gitlab.ref" placeholder="ref, e.g. main" class="font-mono" />
                <UInput
                  v-model="ciRerun.gitlab.variableName"
                  placeholder="variable name, e.g. PW_ARGS"
                  class="font-mono"
                />
              </div>
            </div>
            <div class="space-y-2">
              <p class="text-xs font-medium text-muted">Bitbucket — custom pipeline</p>
              <div class="grid gap-2 sm:grid-cols-2">
                <UInput
                  v-model="ciRerun.bitbucket.pipeline"
                  placeholder="custom pipeline name, e.g. rerun"
                  class="font-mono"
                />
                <UInput
                  v-model="ciRerun.bitbucket.variableName"
                  placeholder="variable name, e.g. PW_ARGS"
                  class="font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      </UFormField>
    </template>

    <UFormField
      label="Tags"
      name="tags"
      description="Select existing tags or type a new name and press Enter to create one."
    >
      <TagsSelect v-model="tags" :all-tags="allTags" class="w-full" @tag-created="emit('tag-created')" />
    </UFormField>
  </div>
</template>
