import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import AskDocs from './components/AskDocs.vue'
import ConfigModeSwitch from './components/ConfigModeSwitch.vue'
import DemoExamples from './components/DemoExamples.vue'
import EnvWizard from './components/EnvWizard.vue'
import Needs from './components/Needs.vue'
import './custom.css'

// Extends the default VitePress theme with a small amount of custom CSS (see
// custom.css) — used to style inline screenshot figures on content pages — the
// configuration reference/generator components used on /configuration and
// /configuration/generator, the <Needs> prerequisite row on feature pages, and
// the <DemoExamples> list under a feature page's "Try it in the demo" heading,
// and the "Ask the docs" button in the nav bar, next to the search box.
export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'nav-bar-content-before': () => h(AskDocs) }),
  enhanceApp({ app }) {
    app.component('ConfigModeSwitch', ConfigModeSwitch)
    app.component('DemoExamples', DemoExamples)
    app.component('EnvWizard', EnvWizard)
    app.component('Needs', Needs)
  },
} satisfies Theme
