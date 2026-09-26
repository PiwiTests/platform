import widgetHandler from '../widgets/[widget].get';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Cross-project analytics widget data (former path)',
    description:
      'The former path of `GET /api/widgets/{widget}`, same answer, kept for scripts. The app calls the new path: ad blockers (uBlock Origin among them) refuse requests whose address contains "analytics".',
    deprecated: true,
    parameters: [{ name: 'widget', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default widgetHandler;
