<script setup lang="ts">
import type { ModelInfo } from '~~/types/api';

const props = defineProps<{
  provider: string;
  providerResolved: string;
  reuse: boolean;
  models: ModelInfo[];
  loadingModels: boolean;
  placeholderAnthropic: string;
  placeholderOpenai: string;
}>();

const emit = defineEmits<{ loadModels: [] }>();

const model = defineModel<string>({ required: true });

const pickerOpen = ref(false);
</script>

<template>
  <div class="flex gap-2">
    <UInput
      v-model="model"
      :placeholder="providerResolved === 'anthropic' ? placeholderAnthropic : placeholderOpenai"
      class="flex-1"
    />
    <UButton
      v-if="providerResolved"
      size="sm"
      variant="soft"
      @click="
        emit('loadModels');
        pickerOpen = true;
      "
    >
      Choose model…
    </UButton>
  </div>

  <ModelPickerModal
    v-model:open="pickerOpen"
    :models="models"
    :selected="model"
    :loading="loadingModels"
    @select="(id: string) => (model = id)"
  />
</template>
