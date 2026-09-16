import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { subscriptions } from '../../database/schema';
import { requireAuth } from '../../utils/auth';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Delete a subscription',
    description: 'Deletes a subscription.',
    'x-required-roles': [],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid subscription ID' });

  const db = await getDatabase();
  const isAdmin = user.role === Role.ADMINISTRATOR;
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(isAdmin ? eq(subscriptions.id, id) : and(eq(subscriptions.id, id), eq(subscriptions.userId, user.id)));
  if (!sub) throw apiError({ statusCode: 404, message: 'Subscription not found' });

  await db.delete(subscriptions).where(eq(subscriptions.id, id));
  return { success: true };
});
