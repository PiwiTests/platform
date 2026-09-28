/**
 * The extension's DevTools page, loaded once per DevTools window: it adds the
 * Piwi pane to the Elements panel and the Piwi panel.
 */
chrome.devtools.panels.create('Piwi', 'icons/icon-32.png', 'devtools-panel.html');

chrome.devtools.panels.elements.createSidebarPane('Piwi', (pane) => {
  pane.setPage('devtools-sidebar.html');
});
