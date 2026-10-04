/**
 * Applies the viewer's effective date/time format on the client.
 *
 * Client-only: absolute dates and relative times render client-only
 * (`ClientDate`, `<ClientOnly>`), so the formatter prefs only ever need to be
 * set in the browser. Seeds from the env layer immediately (so an env-pinned
 * format is right on first paint), keeps the shared formatter prefs in sync when
 * the effective locale/zone changes (a viewer switching their override, or the
 * stored instance default arriving), and pulls that stored default in the
 * background.
 */
export default defineNuxtPlugin(() => {
  const locale = useLocaleSettings();

  void locale.applyActive();

  watch([locale.effectiveLocale, locale.effectiveTimeZone], () => {
    void locale.applyActive();
  });

  // Background: layer the stored app setting onto the env/built-in seed. The
  // watch above re-applies when this changes the effective values.
  void locale.refreshInstance();
});
