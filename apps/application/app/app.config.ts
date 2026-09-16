export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc',
      // Statuses use calmer hues than the raw defaults: the brand green scale
      // (see main.css) is too neon for a "passed" chip, and pure red/yellow
      // read harsh next to it. Emerald/rose/amber keep the same meaning with
      // a softer, more even palette.
      success: 'emerald',
      error: 'rose',
      warning: 'amber',
    },
    card: {
      slots: {
        // Below `sm` a card goes full-bleed: no page gutter, no side border and no
        // side radius, so text starts 12 px from the screen edge on its own inner
        // padding. Top and bottom borders stay. From `sm` up the Nuxt UI default
        // (bordered, rounded, `p-6`) applies unchanged.
        root: 'max-sm:rounded-none max-sm:border-x-0',
        // Solid muted header so block headers clearly separate from the card body
        // in both modes (zinc-100 on white / zinc-800 on zinc-900). Below `sm` the
        // header adds 12 px per side; from `sm` up it is `px-6`.
        header: 'px-3 py-3 sm:px-6 bg-muted',
        body: 'max-sm:p-3',
        footer: 'max-sm:p-3',
      },
    },
    dashboardPanel: {
      slots: {
        // Below `sm` the page has no side gutter: cards are full-bleed and their own
        // 12 px padding is the only inset. Vertical padding and the `sm`-and-up
        // default (`p-6`) are the Nuxt UI defaults.
        body: 'max-sm:px-0',
      },
    },
    table: {
      slots: {
        // Reduce default table cell padding globally (default is px-4 py-3.5 / p-4)
        th: 'px-3 py-2',
        td: 'px-3 py-2',
      },
    },
  },
});
