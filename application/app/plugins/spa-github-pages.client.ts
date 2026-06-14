// GitHub Pages SPA redirect restore.
//
// When the demo is deployed on GitHub Pages and the user navigates directly to
// a deep link (or reloads), GitHub Pages serves 404.html which saves the
// intended path in sessionStorage and redirects to the SPA root.  This plugin
// reads that saved path and replaces the current route so the user lands on the
// correct page without seeing the root view first.
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  if (!config.public.demoMode) {
    return;
  }

  const redirect = sessionStorage.getItem('spa:redirect');
  if (!redirect) {
    return;
  }

  sessionStorage.removeItem('spa:redirect');

  nuxtApp.hook('app:mounted', () => {
    const router = useRouter();
    router.replace(redirect);
  });
});
