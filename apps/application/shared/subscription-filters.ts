import { z } from 'zod';
import type { SubscriptionFilters } from '#shared/notification-events';

/** The delivery filters a subscription stores, as the create and update endpoints validate them. */
export const subscriptionFiltersSchema = z.object({
  branches: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  defaultBranchOnly: z.boolean().optional(),
  owners: z.array(z.string()).optional(),
  flakinessThreshold: z.number().min(0).max(1).optional(),
  perfRegressionPct: z.number().min(0).optional(),
}) satisfies z.ZodType<SubscriptionFilters>;
