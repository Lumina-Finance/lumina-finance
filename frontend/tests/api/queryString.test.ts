/**
 * Covers the shared API query-string builder used by hooks and request helpers
 *
 * These tests catch regressions where optional values are sent accidentally,
 * or meaningful values like zero and false are dropped from request URLs
 */
import { describe, expect, it } from 'vitest';

import { buildQueryString } from '@/api/queryString';

describe('buildQueryString', () => {
  it('returns an empty suffix when all parameters are absent', () => {
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString({ q: '', account_id: undefined, merchant_id: null })).toBe('');
  });

  it('encodes present parameters in insertion order', () => {
    expect(buildQueryString({
      account_id: 'acc_123',
      q: 'coffee shop',
      limit: 25,
    })).toBe('?account_id=acc_123&q=coffee+shop&limit=25');
  });

  it('preserves meaningful false-y values', () => {
    expect(buildQueryString({
      offset: 0,
      include_anchor: false,
    })).toBe('?offset=0&include_anchor=false');
  });
});
