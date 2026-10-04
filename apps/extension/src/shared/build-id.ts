/**
 * The build a bundle came from, stamped into every bundle by
 * `scripts/build.mjs`. Chrome keeps running the background worker an unpacked
 * extension started with until the extension is reloaded, while the popup and
 * the injected tools are read from disk each time they open. After a rebuild
 * without a reload the two therefore run different builds, and comparing this
 * stamp is how the popup and the tools notice.
 */
declare const __PIWI_BUILD_ID__: string | undefined;

export const BUILD_ID: string = typeof __PIWI_BUILD_ID__ === 'string' ? __PIWI_BUILD_ID__ : 'unstamped';
