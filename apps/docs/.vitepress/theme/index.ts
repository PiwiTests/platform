import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import ConfigModeSwitch from './components/ConfigModeSwitch.vue'
import EnvWizard from './components/EnvWizard.vue'
import Needs from './components/Needs.vue'
import './custom.css'

// Extends the default VitePress theme with a small amount of custom CSS (see
// custom.css) — used to style inline screenshot figures on content pages — the
// configuration reference/generator components used on /configuration and
// /configuration/generator, and the <Needs> prerequisite row on feature pages.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ConfigModeSwitch', ConfigModeSwitch)
    app.component('EnvWizard', EnvWizard)
    app.component('Needs', Needs)
  },
} satisfies Theme
