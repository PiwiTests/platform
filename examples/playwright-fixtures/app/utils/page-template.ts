/** Shared HTML shell for the demo pages. */
export const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; }
    nav a { margin-right: 1rem; }
    label { display: block; margin-top: 0.75rem; }
    input, textarea, select { display: block; margin-top: 0.25rem; width: 100%; max-width: 24rem; }
    button { margin-top: 1rem; }
  </style>
</head>
<body>
  <nav><a href="/">Home</a><a href="/form">Form</a><a href="/popup">Popup</a><a href="/slow">Slow</a><a href="/backend">Backend</a><a href="/shop">Shop</a></nav>
  ${body}
</body>
</html>`;

/** Serve a page route: the HTML content type is set explicitly for clarity. */
export const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
