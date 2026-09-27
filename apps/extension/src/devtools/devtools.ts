/**
 * The extension's DevTools page, loaded once per DevTools window: it adds the
 * Piwi pane to the Elements panel.
 */
chrome.devtools.panels.elements.createSidebarPane('Piwi', (pane) => {
  pane.setPage('devtools-sidebar.html');
});
