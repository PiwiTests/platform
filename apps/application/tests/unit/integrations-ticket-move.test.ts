import { describe, test, expect } from 'vitest';
import { ticketMove } from '../../server/utils/integrations/types';

describe('ticketMove', () => {
  test('reads a move into Done, including the first sync of a ticket already Done', () => {
    expect(ticketMove('indeterminate', 'done')).toBe('done');
    expect(ticketMove(null, 'done')).toBe('done');
  });

  test('reads a move out of Done as a reopen', () => {
    expect(ticketMove('done', 'indeterminate')).toBe('reopened');
    expect(ticketMove('done', 'new')).toBe('reopened');
  });

  test('reads no move while the ticket stays where it was', () => {
    expect(ticketMove('indeterminate', 'indeterminate')).toBeNull();
    expect(ticketMove('done', 'done')).toBeNull();
    expect(ticketMove(null, 'indeterminate')).toBeNull();
  });
});
