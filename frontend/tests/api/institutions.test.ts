/**
 * Covers institution API request functions used by account creation and identity edits
 *
 * These tests catch regressions where institution list and create requests call
 * the wrong endpoint or send malformed create payloads
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  createInstitution,
  fetchInstitutions,
} from '@/api/institutions';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue({});
});

describe('institution API functions', () => {
  it('requests institutions from the list endpoint', async () => {
    await fetchInstitutions();

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/institutions');
  });

  it('creates institutions with country and website fields', async () => {
    await createInstitution({
      name: 'Royal Bank of Canada',
      country_code: 'CA',
      website: 'https://www.rbcroyalbank.com',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/institutions', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Royal Bank of Canada',
        country_code: 'CA',
        website: 'https://www.rbcroyalbank.com',
      }),
    });
  });
});
