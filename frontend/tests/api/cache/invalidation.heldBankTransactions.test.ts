/**
 * Verifies that invalidating app data also marks the OFX held-rows check stale, so an import or an undo
 * in another tab makes the preview ask which transactions an account holds again instead of flagging
 * rows from before
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateAppData } from '@/api/cache/invalidation';
import { heldBankTransactionKeys } from '@/api/cache/queryKeys';

describe('app data invalidation', () => {
  it('marks the held-rows check stale so another tab asks again', () => {
    const client = new QueryClient();
    const key = heldBankTransactionKeys.check({ fileIds: ['file-1'], statements: [[0, 'account-1']] });
    client.setQueryData(key, { held: [0] });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);

    invalidateAppData(client);

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.clear();
  });
});
