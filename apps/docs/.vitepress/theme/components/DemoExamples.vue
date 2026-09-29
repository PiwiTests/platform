<script setup lang="ts">
/**
 * A feature page's examples in the live demo: each a link to a concrete screen
 * and a sentence on what it shows, from the demo examples registry
 * (apps/application/shared/demo/demo-examples.mjs), whose entries the seed is
 * checked against. The page rendering it picks its entries, so it takes no
 * props; it sits under the page's own heading:
 *
 *   ## Try it in the demo
 *
 *   <DemoExamples />
 *
 * The demo is deployed beside the docs at /demo/, so the links carry the site
 * base. They open in a new tab: a link with a target is one VitePress's router
 * leaves to the browser instead of loading it as a docs page.
 */
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { demoExamplesFor } from '#shared/demo/demo-examples.mjs'

const { page } = useData()
const examples = computed(() => demoExamplesFor(page.value.relativePath.replace(/\.md$/, '')))
</script>

<template>
  <ul class="demo-examples">
    <li v-for="example in examples" :key="example.id" :data-example="example.id">
      <a :href="withBase(`/demo${example.route}`)" target="_blank" rel="noreferrer">{{ example.title }}</a>:
      {{ example.shows }}
    </li>
  </ul>
</template>
