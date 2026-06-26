<script setup lang="ts">
/**
 * Discreet inline-help affordance: a small muted help icon that opens a popover
 * with a short explanation and an optional "Learn more" docs link. Resolve copy
 * from the shared registry via `topic`, or pass `title`/`text`/`doc` inline for
 * one-offs.
 *
 * Click-mode popover (not a hover tooltip) so the content can hold a real link
 * and stay keyboard- and touch-accessible. Use `i-lucide-circle-help` here and
 * reserve `i-lucide-info` for informational/empty-state callouts.
 */
import { HELP_TOPICS, type HelpTopic, type HelpTopicKey } from '~/utils/help-content';
import type { PiwiEnvVarName } from '~~/shared/piwi-env-vars';
import { getEnvVarMeta } from '~~/shared/piwi-env-vars';

const props = defineProps<{
  /** Resolve copy from the registry… */
  topic?: HelpTopicKey;
  /** …or pass inline for rare one-offs. */
  title?: string;
  text?: string;
  doc?: string;
  /** Env var(s) that override this setting; shown as copyable mono lines. */
  envVars?: PiwiEnvVarName[];
  /** Trigger icon size. Default 'xs'. */
  size?: 'xs' | 'sm';
}>();

const { copy } = useCopy();

const entry = computed<HelpTopic | null>(() => (props.topic ? HELP_TOPICS[props.topic] : null));
const title = computed(() => props.title ?? entry.value?.title);
const text = computed(() => props.text ?? entry.value?.text ?? '');
const doc = computed(() => props.doc ?? entry.value?.doc);
const envVars = computed(() => props.envVars ?? entry.value?.envVars);

const open = ref(false);
</script>

<template>
  <UPopover v-model:open="open" :ui="{ content: 'max-w-xs p-3 text-sm' }">
    <UButton
      :size="size ?? 'xs'"
      variant="ghost"
      color="neutral"
      icon="i-lucide-circle-help"
      :aria-label="title ? `Help: ${title}` : 'Help'"
      title="What is this?"
      class="text-muted hover:text-default align-middle"
    />

    <template #content>
      <p v-if="title" class="font-medium mb-1">{{ title }}</p>
      <p class="text-muted">{{ text }}</p>
      <div v-if="envVars?.length" class="mt-2 space-y-1">
        <p class="text-muted text-xs">Environment variable{{ envVars.length > 1 ? 's' : '' }}:</p>
        <div class="flex flex-col gap-1.5">
          <button
            v-for="v in envVars"
            :key="v"
            type="button"
            class="group text-left"
            :title="`Click to copy ${v}`"
            @click="copy(v, { toast: `Copied ${v}` })"
          >
            <code
              class="block font-mono text-xs bg-elevated rounded px-1.5 py-0.5 select-all cursor-pointer group-hover:ring-1 ring-default"
            >
              {{ v }}
            </code>
            <span v-if="getEnvVarMeta(v).description" class="block text-muted text-[11px] mt-0.5">
              {{ getEnvVarMeta(v).description }}
            </span>
          </button>
        </div>
      </div>
      <div v-if="doc || envVars?.length" class="mt-2 flex flex-col gap-1">
        <DocLink v-if="doc" :to="doc">Learn more</DocLink>
        <DocLink v-if="envVars?.length" to="configuration">Configuration reference</DocLink>
      </div>
    </template>
  </UPopover>
</template>
