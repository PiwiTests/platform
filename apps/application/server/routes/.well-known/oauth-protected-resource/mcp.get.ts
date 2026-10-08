import handler from '../oauth-protected-resource.get';

defineRouteMeta({
  openAPI: {
    tags: ['MCP OAuth'],
    summary: 'Protected resource metadata of the MCP server, at its path-suffixed address',
    description:
      'The same document as `/.well-known/oauth-protected-resource`, at the address RFC 9728 §3.1 derives from the `/mcp` URL. 404 when authentication is off.',
    security: [],
  },
});

export default handler;
