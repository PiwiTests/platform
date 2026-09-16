<script setup lang="ts">
/**
 * A single click-to-enlarge image. It carries the interaction affordance — a
 * hover / focus "zoom" overlay, keyboard activation and a focus ring — and emits
 * `open` so the caller can drive a shared `ScreenshotLightbox`. The frame's look
 * (radius, background, height) is the caller's via `frameClass`; the fit is the
 * caller's via `imgClass`. A failing frame gets a red ring so it reads at a glance.
 */
defineProps<{
  src: string;
  alt: string;
  /** Sizing / object-fit for the `<img>` (e.g. `h-28 w-full object-cover object-top`). */
  imgClass?: string;
  /** Framing for the wrapper (radius, background, fixed height, centering). */
  frameClass?: string;
  /** Emphasize the frame as the failing one. */
  failed?: boolean;
  /** Shrink the frame to the image instead of filling the container (`w-full`). */
  inline?: boolean;
}>();

const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <div
    class="group relative cursor-zoom-in overflow-hidden outline-none transition-colors focus-visible:outline-2 focus-visible:outline-primary"
    :class="[
      inline ? 'inline-block max-w-full align-top' : 'block w-full',
      failed ? 'border border-red-500 ring-1 ring-red-500' : 'border border-default',
      frameClass,
    ]"
    role="button"
    tabindex="0"
    :aria-label="`Enlarge ${alt}`"
    @click="emit('open')"
    @keydown.enter="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <img :src="src" :alt="alt" loading="lazy" class="block" :class="imgClass" />

    <!-- Enlarge affordance — appears on hover and on keyboard focus. -->
    <div
      class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      <span
        class="inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-xs font-medium text-white shadow-sm"
      >
        <UIcon name="i-lucide-zoom-in" class="size-3.5" />
        Enlarge
      </span>
    </div>

    <!-- Caller-supplied overlays (a caption bar, a badge). -->
    <slot />
  </div>
</template>
