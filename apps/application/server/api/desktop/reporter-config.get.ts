// Desktop-only: returns the local server URL + the access token to configure the
// Playwright reporter against this app. Responds 404 on the normal server build
// (no PIWI_DESKTOP_TOKEN). This route sits under /api, so the desktop guard
// already requires the token cookie to reach it — only the app's own window can
// read the value, never an external caller.
defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Get reporter configuration for the desktop app',
    description:
      'Desktop build only. Returns the local server URL and the access token to point the Playwright reporter at this app. 404 on the server build.',
    security: [],
  },
});

export default eventHandler(() => {
  const token = process.env.PIWI_DESKTOP_TOKEN;
  if (!token) {
    // Not the desktop build — return null (rather than 404) so the settings
    // page's useFetch resolves cleanly and simply hides the card.
    return null;
  }

  const port = process.env.NITRO_PORT || process.env.PORT || '3000';
  return {
    url: `http://localhost:${port}`,
    token,
  };
});
