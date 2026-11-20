import type { QueryClient } from '@tanstack/react-query'
import { invalidateAccounts, invalidateInstitutionPages } from '@/api/cache/invalidation'
import { institutionKeys } from '@/api/cache/queryKeys'
import type { Institution } from '@/api/institutions/types'

/**
 * Caches a created institution's record and refreshes the pages the pickers hold, so the new
 * institution is found in the list and by search
 */
export function updateCreatedInstitution(queryClient: QueryClient, institution: Institution) {
  queryClient.setQueryData<Institution>(institutionKeys.detail(institution.id), institution)
  invalidateInstitutionPages(queryClient)
}

/**
 * Writes a corrected institution into its cached record, refreshes the pages the pickers hold and
 * refreshes the accounts that embed it
 *
 * A correction that renames an institution moves it within the name order, and the pages the
 * server sorted cannot show that until they are read again. The account invalidation covers
 * everywhere an institution is shown against an account, meaning the account list, account detail
 * and the transaction rows. All of them read the copy embedded in an account response rather than
 * the picker's pages
 */
export function updateCachedInstitution(queryClient: QueryClient, institution: Institution) {
  queryClient.setQueryData<Institution>(institutionKeys.detail(institution.id), institution)
  invalidateInstitutionPages(queryClient)
  invalidateAccounts(queryClient)
}
