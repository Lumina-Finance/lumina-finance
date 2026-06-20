/**
 * Covers the shared API query-string builder used by hooks and request helpers
 *
 * These tests catch regressions where optional values are sent accidentally,
 * or meaningful values like zero and false are dropped from request URLs
 */
import { describe, expect, it } from 'vitest';

import { buildQueryString } from '@/api/utils/queryString';

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

  it('emits one repeated key per item for array values', () => {
    expect(buildQueryString({
      account_id: ['acc_1', 'acc_2'],
      tag_match: 'all',
    })).toBe('?account_id=acc_1&account_id=acc_2&tag_match=all');
  });

  it('drops empty arrays and empty items', () => {
    expect(buildQueryString({
      account_id: [],
      tag_id: ['tag_1', ''],
    })).toBe('?tag_id=tag_1');
  });
});
