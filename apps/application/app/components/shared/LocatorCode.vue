<script setup lang="ts">
/**
 * A Playwright locator expression rendered as code. By default it is
 * syntax-highlighted: method names, string arguments, option keys and literals
 * each get their own color, in a palette that keeps its contrast in both light
 * and dark mode. In `plain` mode the tokens inherit the surrounding color, for a
 * locator that sits inside a heading or a sentence and must not compete with it.
 *
 * The lexer is `@piwitests/picker-dom`'s `tokenizeLocator`, the same one the
 * picker overlays highlight with, so a locator reads identically in the
 * dashboard, the extension panels and the in-page picker chrome.
 */
import { tokenizeLocator, type LocatorTokenKind } from '@piwitests/picker-dom/syntax-highlight';

const props = withDefaults(
  defineProps<{
    locator: string;
    /** Keeps the expression on one line, ellipsized — for dense list rows. */
    truncate?: boolean;
    /** Inherit the surrounding color instead of highlighting the tokens. */
    plain?: boolean;
  }>(),
  { truncate: false, plain: false },
);

const TOKEN_CLASS: Record<LocatorTokenKind, string> = {
  method: 'text-violet-700 dark:text-violet-300',
  string: 'text-green-700 dark:text-green-300',
  option: 'text-blue-700 dark:text-blue-300',
  literal: 'text-amber-700 dark:text-amber-300',
  punctuation: 'text-gray-500 dark:text-gray-400',
  plain: '',
};

const tokens = computed(() => tokenizeLocator(props.locator));
</script>

<template>
  <code class="font-mono" :class="truncate ? 'block truncate' : 'break-words'" :title="locator">
    <template v-if="plain">{{ locator }}</template>
    <span v-for="(token, i) in plain ? [] : tokens" :key="i" :class="TOKEN_CLASS[token.kind]">{{ token.text }}</span>
  </code>
</template>
