import { describe, expect, it } from 'vitest';
import type { Query } from '@tanstack/react-query';
import {
  getFxAwareStaleTime,
  hasUncacheableFxStatus,
  shouldPersistFxData,
} from '@/api/shared/fxCache';

const completeFxStatus = {
  state: 'complete',
  missing_pairs: [],
};

const unavailableFxStatus = {
  state: 'unavailable',
  missing_pairs: [{ base: 'USD', quote: 'CAD' }],
};

describe('FX cache status detection', () => {
  it('detects nested non-success FX statuses', () => {
    expect(hasUncacheableFxStatus({
      accounts: [
        {
          id: 'acc_123',
          current_balance_fx_status: unavailableFxStatus,
        },
      ],
    })).toBe(true);
  });

  it('treats none and complete FX statuses as cacheable', () => {
    expect(hasUncacheableFxStatus({
      fx_status: {
        state: 'none',
        missing_pairs: [],
      },
      details: {
        fx_status: completeFxStatus,
      },
    })).toBe(false);
  });

  it('keeps unknown future FX states out of cache', () => {
    expect(hasUncacheableFxStatus({
      fx_status: {
        state: 'errored',
        missing_pairs: [],
      },
    })).toBe(true);
  });
});

describe('FX cache policy', () => {
  it('marks failed FX responses stale and keeps them out of persistent storage', () => {
    const staleTime = getFxAwareStaleTime(600_000);
    const failedQuery = {
      state: {
        data: {
          fx_status: unavailableFxStatus,
        },
      },
    } as unknown as Query;
    const successfulQuery = {
      state: {
        data: {
          fx_status: completeFxStatus,
        },
      },
    } as unknown as Query;

    expect(staleTime(failedQuery)).toBe(0);
    expect(staleTime(successfulQuery)).toBe(600_000);
    expect(shouldPersistFxData(failedQuery.state.data)).toBe(false);
    expect(shouldPersistFxData(successfulQuery.state.data)).toBe(true);
  });
});
