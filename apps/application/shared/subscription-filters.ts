import { z } from 'zod';
import type { SubscriptionFilters } from '#shared/notification-events';

/** Branch or environment names, each an exact name or a `*` pattern. */
const namePatterns = z.array(z.string().trim().min(1));

/** The delivery filters a subscription stores, as the create and update endpoints validate them. */
export const subscriptionFiltersSchema = z.object({
  branches: namePatterns.optional(),
  environments: namePatterns.optional(),
  statuses: z.array(z.string()).optional(),
  defaultBranchOnly: z.boolean().optional(),
  owners: z.array(z.string()).optional(),
  flakinessThreshold: z.number().min(0).max(1).optional(),
  perfRegressionPct: z.number().min(0).optional(),
}) satisfies z.ZodType<SubscriptionFilters>;
