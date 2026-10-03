<script setup lang="ts">
/**
 * One Mermaid diagram inside a `HelpHint` popover. Mermaid is a large library,
 * so it is imported on first use — only when a hint that holds a ```mermaid
 * block is opened — and re-rendered when the color mode flips. A diagram that
 * fails to parse falls back to its source, so a typo in the registry shows up
 * rather than an empty box.
 */
const props = defineProps<{ source: string }>();

const colorMode = useColorMode();
const id = `help-mermaid-${useId()}`;
const svg = ref('');
const failed = ref(false);

async function draw() {
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: colorMode.value === 'dark' ? 'dark' : 'neutral',
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: 12,
    });
    svg.value = (await mermaid.render(id, props.source)).svg;
    failed.value = false;
  } catch {
    failed.value = true;
  }
}

onMounted(draw);
watch(() => [props.source, colorMode.value], draw);
</script>

<template>
  <pre v-if="failed" class="font-mono text-xs whitespace-pre-wrap text-muted">{{ source }}</pre>
  <!-- eslint-disable-next-line vue/no-v-html — Mermaid renders with securityLevel 'strict' from registry copy -->
  <div v-else-if="svg" class="my-2 flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" v-html="svg" />
  <div v-else class="my-2 h-16 rounded bg-elevated animate-pulse" aria-hidden="true" />
</template>
