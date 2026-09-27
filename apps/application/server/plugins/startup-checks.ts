// Startup configuration sanity checks. Warnings only — the app must keep
// working with zero configuration so local evaluation stays friction-free.
export default defineNitroPlugin(() => {
  // Dev servers run with throwaway data; only warn on production builds.
  if (import.meta.dev) return;

  if (!process.env.PIWI_SECRET_KEY) {
    console.warn(
      '\n⚠️  [security] PIWI_SECRET_KEY is not set.\n' +
        '   The dashboard cannot save secrets (AI API keys, SCM tokens, webhook secrets, integration\n' +
        '   credentials) until it is: saving one answers HTTP 409.\n' +
        '   Set PIWI_SECRET_KEY to a long random string. Generate one with:\n' +
        "   node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"\n",
    );
  }
});
