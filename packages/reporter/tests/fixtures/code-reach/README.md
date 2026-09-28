# Code reach build fixture

A small application (`src/`) and its production builds with source maps, as Vite 8 and webpack 5 emit them
(`build/`). `code-reach.spec.ts` serves both and checks the files each click reaches. The builds carry the shapes that
test the mapping: Vite's module preload helper and webpack's module factories and runtime, none of which map to a
source of their own.

- `main.js` imports `analytics.js`, which runs only top-level code: no test reaches it.
- `header.js` renders on load; `cart.js` and `reports.js` (a lazy chunk) on their buttons; both use `format.js`.

To rebuild, from this directory in a scratch project with `vite` and `webpack-cli` installed:
`npx vite build && npx webpack --config webpack.config.cjs`. Then drop `sourcesContent` from the maps and write
`build/webpack/index.html` (the two buttons and `<script src="/webpack/main.js"></script>`).
