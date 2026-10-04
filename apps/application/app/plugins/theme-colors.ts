/**
 * Paints the viewer's saved theme colors (`useThemeColors`) on the server and
 * the client. Runs before Nuxt UI builds its color variables from the app
 * config, so the first render already uses them.
 */
export default defineNuxtPlugin({
  name: 'piwi:theme-colors',
  enforce: 'pre',
  setup() {
    useThemeColors().applySaved();
  },
});
