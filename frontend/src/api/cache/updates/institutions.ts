import type { QueryClient } from '@tanstack/react-query';
import { invalidateAccounts } from '@/api/cache/invalidation';
import { institutionKeys } from '@/api/cache/queryKeys';
import type { Institution } from '@/api/institutions/types';

/**
 * Writes a corrected institution into the cached selector list and refreshes the accounts
 * that embed it
 *
 * The list is sorted by name server-side and nothing re-sorts it here, so a correction that
 * renames an institution has to put it back in order rather than leaving it where it was.
 * The account invalidation is what makes the correction visible at all: every logo and
 * institution label in the app renders from the copy embedded in an account response, not
 * from this list
 */
export function updateCachedInstitution(queryClient: QueryClient, institution: Institution) {
  queryClient.setQueryData<Institution[]>(institutionKeys.list(), (institutions) => {
    if (!institutions) return institutions;
    return institutions
      .map((item) => (item.id === institution.id ? institution : item))
      .sort((left, right) => left.name.localeCompare(right.name));
  });

  invalidateAccounts(queryClient);
}
