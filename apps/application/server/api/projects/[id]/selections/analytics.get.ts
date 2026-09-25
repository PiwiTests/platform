import overviewHandler from './overview.get';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Health and drift of a project’s selections (former path)',
    description:
      'The former path of `GET /api/projects/{id}/selections/overview`, same answer, kept for scripts. The app calls the new path: ad blockers (uBlock Origin among them) refuse requests whose address contains "analytics".',
    deprecated: true,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default overviewHandler;
