<script setup lang="ts">
/**
 * One model-role editor (diagnosis / research / embedding) for Settings → AI.
 * Rendered once per role; each instance owns its own scope and generated field
 * ids, so the three cards never collide. State is the shared reactive role form,
 * bound via v-model.
 */
import type { AiModelRole } from '~~/types/api';
import type { HelpTopicKey } from '~/utils/help-content';

export interface RoleForm {
  enabled: boolean;
  reuse: AiModelRole | null;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface RoleMeta {
  key: AiModelRole;
  title: string;
  icon: string;
  help: HelpTopicKey;
  optional: boolean;
  enableLabel: string;
  blurb: string;
  reuseTargets: readonly AiModelRole[];
  modelPlaceholderAnthropic: string;
  modelPlaceholderOpenai: string;
}

defineProps<{
  meta: RoleMeta;
  hasApiKey: boolean;
  reuseOptions: Array<{ label: string; value: string }>;
  providerOptions: Array<{ label: string; value: string }>;
  presetOptions: Array<{ label: string; value: string }>;
  disabled: boolean;
}>();

const emit = defineEmits<{ applyPreset: [label: string] }>();

const model = defineModel<RoleForm>({ required: true });

// 'own' sentinel ↔ null (configure own provider). Proxied so the <USelect> can
// use a plain v-model with non-empty option values.
const reuseModel = computed<string>({
  get: () => model.value.reuse ?? 'own',
  set: (v) => (model.value.reuse = v === 'own' ? null : (v as AiModelRole)),
});
</script>

<template>
  <div
    class="rounded-lg border border-default p-4 space-y-4"
    :class="meta.optional && !model.enabled ? 'opacity-80' : ''"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-2">
        <UIcon :name="meta.icon" class="size-5 mt-0.5 text-primary" />
        <div>
          <p class="font-medium inline-flex items-center gap-1">{{ meta.title }} <HelpHint :topic="meta.help" /></p>
          <p class="text-sm text-gray-500">{{ meta.blurb }}</p>
        </div>
      </div>
      <USwitch v-if="meta.optional" v-model="model.enabled" :disabled="disabled" :aria-label="meta.enableLabel" />
    </div>

    <template v-if="!meta.optional || model.enabled">
      <UFormField v-if="meta.reuseTargets.length" label="Provider source">
        <USelect v-model="reuseModel" :items="reuseOptions" :disabled="disabled" class="w-full" />
      </UFormField>

      <template v-if="!model.reuse">
        <UFormField label="Provider">
          <USelect
            v-model="model.provider"
            :items="providerOptions"
            :disabled="disabled"
            placeholder="Choose a provider…"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="model.provider === 'openai'"
          label="Preset"
          description="Pick a known provider to auto-fill the URL and model, then adjust as needed"
        >
          <USelect
            :items="presetOptions"
            placeholder="Choose a preset…"
            :disabled="disabled"
            class="w-full"
            @update:model-value="(v: string) => emit('applyPreset', v)"
          />
        </UFormField>

        <UFormField
          v-if="model.provider"
          label="API key"
          :description="
            hasApiKey
              ? 'Leave empty to keep the stored key, clear and save to remove it'
              : 'Required for Anthropic; optional for local OpenAI-compatible servers'
          "
        >
          <UInput
            v-model="model.apiKey"
            type="password"
            :placeholder="hasApiKey ? '•••••••• (unchanged)' : 'sk-…'"
            :disabled="disabled"
            class="w-full font-mono"
          />
        </UFormField>

        <UFormField
          v-if="model.provider === 'openai'"
          label="Base URL"
          description="Required, e.g. http://localhost:11434/v1"
        >
          <UInput v-model="model.baseUrl" placeholder="http://localhost:11434/v1" :disabled="disabled" class="w-full" />
        </UFormField>
      </template>

      <UFormField
        v-if="model.reuse || model.provider"
        label="Model"
        :description="model.reuse ? 'Leave empty to use the reused role\'s model' : undefined"
      >
        <UInput
          v-model="model.model"
          :placeholder="model.provider === 'anthropic' ? meta.modelPlaceholderAnthropic : meta.modelPlaceholderOpenai"
          :disabled="disabled"
          class="w-full"
        />
      </UFormField>
    </template>
  </div>
</template>
