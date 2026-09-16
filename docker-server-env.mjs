// Preloaded (via `node --import`) before the bundled server starts.
//
// The prebuilt server bakes its runtime config at build time and only honors
// NUXT_*-prefixed overrides at run time. Map the operator-facing PIWI_AUTH_*
// variables onto those overrides so enabling authentication at run time takes
// effect on both the server and the browser (public) config. Existing NUXT_*
// values win, and PIWI_SECRET_KEY / PIWI_AUTH_ENABLED are still read directly by
// the server, so this only reconciles the pieces baked into the bundle.
if (process.env.PIWI_AUTH_ENABLED === 'true') {
  process.env.NUXT_AUTH_ENABLED ??= 'true';
  process.env.NUXT_PUBLIC_AUTH_ENABLED ??= 'true';
}
if (process.env.PIWI_AUTH_SECRET) {
  process.env.NUXT_AUTH_SECRET ??= process.env.PIWI_AUTH_SECRET;
}

// OAuth settings live in the baked runtime config as well, so each PIWI_OAUTH_*
// value is mirrored onto the NUXT_* override the server actually reads. An
// operator who set the NUXT_* name directly keeps that value.
const OAUTH_ENV = {
  PIWI_OAUTH_GOOGLE_CLIENT_ID: 'NUXT_OAUTH_GOOGLE_CLIENT_ID',
  PIWI_OAUTH_GOOGLE_CLIENT_SECRET: 'NUXT_OAUTH_GOOGLE_CLIENT_SECRET',
  PIWI_OAUTH_GITHUB_CLIENT_ID: 'NUXT_OAUTH_GITHUB_CLIENT_ID',
  PIWI_OAUTH_GITHUB_CLIENT_SECRET: 'NUXT_OAUTH_GITHUB_CLIENT_SECRET',
  PIWI_OAUTH_ALLOWED_DOMAINS: 'NUXT_OAUTH_ALLOWED_DOMAINS',
  PIWI_OAUTH_GITHUB_ALLOWED_ORGS: 'NUXT_OAUTH_GITHUB_ALLOWED_ORGS',
};
for (const [piwiName, nuxtName] of Object.entries(OAUTH_ENV)) {
  if (process.env[piwiName]) process.env[nuxtName] ??= process.env[piwiName];
}

// The login page lists its sign-in buttons from `public.oauthProviders`, baked
// at build time. Derive it from the providers that have both a client id and a
// secret, unless the operator set NUXT_PUBLIC_OAUTH_PROVIDERS directly.
const configuredProviders = ['google', 'github'].filter((provider) => {
  const key = provider.toUpperCase();
  return process.env[`NUXT_OAUTH_${key}_CLIENT_ID`] && process.env[`NUXT_OAUTH_${key}_CLIENT_SECRET`];
});
if (configuredProviders.length > 0) {
  process.env.NUXT_PUBLIC_OAUTH_PROVIDERS ??= JSON.stringify(configuredProviders);
}
