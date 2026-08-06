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
 * Writing the list covers the institution pickers, which build their options from it. The
 * account invalidation covers everywhere an institution is shown against an account, meaning
 * the account list, account detail and the transaction rows, all of which read the copy
 * embedded in an account response rather than this list
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
