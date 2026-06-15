export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc',
    },
    card: {
      slots: {
        header: 'px-3 py-3 sm:px-6 bg-muted/60',
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
