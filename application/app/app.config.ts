export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'zinc',
    },
    card: {
      slots: {
        header: 'p-4 sm:px-6 bg-muted/30',
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
