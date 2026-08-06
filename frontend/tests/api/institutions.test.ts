/**
 * Covers institution API request functions used by account creation, identity edits and
 * the correction a user submits to an institution
 *
 * These tests catch regressions where institution list, create and correction requests
 * call the wrong endpoint or send a malformed payload
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
  updateInstitution,
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

  it('sends a correction to the institution being corrected, carrying only the fields given', async () => {
    await updateInstitution({
      institutionId: '11111111-1111-1111-1111-111111111111',
      payload: { website: 'https://www.rbcroyalbank.com' },
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/institutions/11111111-1111-1111-1111-111111111111',
      {
        method: 'PATCH',
        body: JSON.stringify({ website: 'https://www.rbcroyalbank.com' }),
      },
    );
  });
});
