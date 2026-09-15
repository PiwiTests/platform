<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';

const props = defineProps<{
  images: Array<{ src: string; name: string }>;
  modelValue: number | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number | null];
}>();

const isOpen = computed(() => props.modelValue !== null);

// Natural size of the shown image, read on load — drives whether "actual size"
// can reveal more than the fitted view already shows.
const natural = ref<{ w: number; h: number } | null>(null);
const zoomed = ref(false);
const { width: vw, height: vh } = useWindowSize();

// Fitted view caps the image at 92vw / 88vh, so it can only zoom past the fit
// when the source is larger than that. Small screenshots never offer the toggle.
const canZoom = computed(
  () => !!natural.value && (natural.value.w > vw.value * 0.92 || natural.value.h > vh.value * 0.88),
);

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

function toggleZoom() {
  if (canZoom.value) zoomed.value = !zoomed.value;
}

function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  natural.value = { w: img.naturalWidth, h: img.naturalHeight };
}

const currentImage = computed(() => {
  if (props.modelValue === null) return null;
  return props.images[props.modelValue] ?? null;
});

// Reset the per-image state whenever the shown image (or open state) changes, so
// a zoomed-in view never carries over to the next screenshot.
watch(
  () => props.modelValue,
  () => {
    zoomed.value = false;
    natural.value = null;
  },
);

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return;
  if (e.key === 'Escape') {
    if (zoomed.value) zoomed.value = false;
    else close();
  }
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="isOpen" class="fixed inset-0 z-50 bg-black/90">
        <!-- Scrollable stage: centers the fitted image, and pans it when zoomed. -->
        <div class="absolute inset-0 flex overflow-auto p-4 sm:p-10" @click.self="close">
          <img
            v-if="currentImage"
            :src="currentImage.src"
            :alt="currentImage.name"
            class="m-auto rounded-lg shadow-2xl"
            :class="[
              zoomed ? 'max-w-none' : 'max-h-[88vh] max-w-[92vw] object-contain',
              canZoom ? (zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in') : '',
            ]"
            @click.stop="toggleZoom"
            @load="onImgLoad"
          />
        </div>

        <!-- Counter -->
        <div
          v-if="images.length > 1"
          class="pointer-events-none absolute top-4 left-4 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/80 tabular-nums"
        >
          {{ (modelValue ?? 0) + 1 }} / {{ images.length }}
        </div>

        <!-- Actions -->
        <div class="absolute top-4 right-4 flex items-center gap-2">
          <button
            v-if="canZoom"
            class="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            :title="zoomed ? 'Fit to screen' : 'Actual size'"
            :aria-label="zoomed ? 'Fit to screen' : 'Actual size'"
            @click="toggleZoom"
          >
            <UIcon :name="zoomed ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="size-5" />
          </button>
          <button
            class="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            title="Close"
            aria-label="Close"
            @click="close"
          >
            <UIcon name="i-lucide-x" class="size-6" />
          </button>
        </div>

        <button
          v-if="images.length > 1 && (modelValue ?? 0) > 0"
          class="absolute top-1/2 left-4 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          title="Previous"
          aria-label="Previous screenshot"
          @click="prev"
        >
          <UIcon name="i-lucide-chevron-left" class="size-6" />
        </button>

        <button
          v-if="images.length > 1 && (modelValue ?? 0) < images.length - 1"
          class="absolute top-1/2 right-4 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          title="Next"
          aria-label="Next screenshot"
          @click="next"
        >
          <UIcon name="i-lucide-chevron-right" class="size-6" />
        </button>

        <!-- Caption -->
        <div v-if="currentImage" class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-16">
          <p class="max-w-full truncate rounded-full bg-black/60 px-3 py-1 text-sm text-white/90">
            {{ currentImage.name }}
          </p>
        </div>
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
