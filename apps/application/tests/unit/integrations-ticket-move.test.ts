import { describe, test, expect } from 'vitest';
import { ticketMove } from '../../server/utils/integrations/types';

describe('ticketMove', () => {
  test('reads a move into Done', () => {
    expect(ticketMove('indeterminate', 'done')).toBe('done');
    expect(ticketMove('new', 'done')).toBe('done');
  });

  test('the first sync of a link records where the ticket stands, even Done, and is no move', () => {
    expect(ticketMove(null, 'done')).toBeNull();
    expect(ticketMove(undefined, 'new')).toBeNull();
  });

  test('a category the tracker omits or does not know is no move, whatever came before', () => {
    expect(ticketMove('done', null)).toBeNull();
    expect(ticketMove('done', undefined)).toBeNull();
    expect(ticketMove('done', 'custom')).toBeNull();
    expect(ticketMove('custom', 'done')).toBeNull();
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
