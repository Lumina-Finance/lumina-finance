/**
 * Verifies that invalidating app data also invalidates the saved Insights ranges, so a range saved or deleted in
 * another session doesn't stay hidden for the list's whole stale time
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateAppData } from '@/api/cache/invalidation';
import { insightsKeys } from '@/api/cache/queryKeys';

describe('app data invalidation', () => {
  it('marks the saved Insights ranges stale so another tab refetches them', () => {
    const client = new QueryClient();
    client.setQueryData(insightsKeys.savedRanges(), [{ id: 'range-1', name: 'Alpha range' }]);
    expect(client.getQueryState(insightsKeys.savedRanges())?.isInvalidated).toBe(false);

    invalidateAppData(client);

    expect(client.getQueryState(insightsKeys.savedRanges())?.isInvalidated).toBe(true);
    client.clear();
  });
});
