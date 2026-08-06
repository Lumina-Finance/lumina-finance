/**
 * Tests the institution cache write a correction relies on to reach the screen
 *
 * useUpdateInstitution calls useMutation and useQueryClient, which need a live React tree to
 * invoke, so this covers updateCachedInstitution directly against a real QueryClient instead
 */
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Institution } from '@/api/institutions';
import { accountKeys, institutionKeys } from '@/api/cache/queryKeys';
import { updateCachedInstitution } from '@/api/cache/updates/institutions';

/**
 * Creates an institution fixture, defaulting the fields a correction does not exercise
 */
function createInstitution(overrides: Partial<Institution> = {}): Institution {
  return {
    id: 'alpha',
    status: 'pending',
    name: 'Alpha Bank',
    country_code: 'CA',
    website: 'https://alpha.example.com',
    logo_url: null,
    ...overrides,
  };
}

describe('updateCachedInstitution', () => {
  it('replaces the corrected entry rather than appending it', () => {
    const queryClient = new QueryClient();
    const alpha = createInstitution();
    const beta = createInstitution({ id: 'beta', name: 'Beta Bank' });
    queryClient.setQueryData(institutionKeys.list(), [alpha, beta]);

    updateCachedInstitution(queryClient, {
      ...beta,
      website: 'https://corrected.example.com',
    });

    const cached = queryClient.getQueryData<Institution[]>(institutionKeys.list());
    expect(cached).toHaveLength(2);
    expect(cached?.[1].website).toBe('https://corrected.example.com');
  });

  it('puts a renamed institution back into name order', () => {
    const queryClient = new QueryClient();
    const zeta = createInstitution({ id: 'zeta', name: 'Zeta Bank' });
    queryClient.setQueryData(institutionKeys.list(), [
      createInstitution(),
      createInstitution({ id: 'beta', name: 'Beta Bank' }),
      zeta,
    ]);

    updateCachedInstitution(queryClient, { ...zeta, name: 'Aaa Bank' });

    const cached = queryClient.getQueryData<Institution[]>(institutionKeys.list());
    expect(cached?.map((institution) => institution.name)).toEqual([
      'Aaa Bank',
      'Alpha Bank',
      'Beta Bank',
    ]);
  });

  it('leaves an unfetched list absent rather than writing an empty one', () => {
    const queryClient = new QueryClient();

    updateCachedInstitution(queryClient, createInstitution());

    expect(queryClient.getQueryData(institutionKeys.list())).toBeUndefined();
  });

  it('invalidates the accounts that embed the corrected institution', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(accountKeys.list(), []);

    updateCachedInstitution(queryClient, createInstitution());

    const accountQuery = queryClient.getQueryCache().find({ queryKey: accountKeys.list() });
    expect(accountQuery?.state.isInvalidated).toBe(true);
  });
});
