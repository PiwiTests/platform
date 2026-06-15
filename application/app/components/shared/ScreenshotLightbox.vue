<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  images: Array<{ src: string; name: string }>;
  modelValue: number | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number | null];
}>();

const isOpen = computed(() => props.modelValue !== null);

function close() {
  emit('update:modelValue', null);
}

function prev() {
  if (props.modelValue !== null && props.modelValue > 0) {
    emit('update:modelValue', props.modelValue - 1);
  }
}

function next() {
  if (props.modelValue !== null && props.modelValue < props.images.length - 1) {
    emit('update:modelValue', props.modelValue + 1);
  }
}

const currentImage = computed(() => {
  if (props.modelValue === null) return null;
  return props.images[props.modelValue] ?? null;
});

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/90" @click.self="close">
        <button
          class="absolute top-4 right-4 size-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          @click="close"
        >
          <UIcon name="i-lucide-x" class="size-6" />
        </button>

        <div class="absolute top-4 left-4 text-white/70 text-sm font-medium">
          {{ (modelValue ?? 0) + 1 }} / {{ images.length }}
        </div>

        <button
          v-if="images.length > 1 && (modelValue ?? 0) > 0"
          class="absolute left-4 size-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          @click="prev"
        >
          <UIcon name="i-lucide-chevron-left" class="size-6" />
        </button>

        <img
          v-if="currentImage"
          :src="currentImage.src"
          :alt="currentImage.name"
          class="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          @click.stop
        />

        <button
          v-if="images.length > 1 && (modelValue ?? 0) < images.length - 1"
          class="absolute right-4 size-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          @click="next"
        >
          <UIcon name="i-lucide-chevron-right" class="size-6" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.2s ease;
}
.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}
</style>
