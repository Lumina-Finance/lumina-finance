import { useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createInstitution,
  fetchInstitution,
  fetchInstitutionsPage,
  updateInstitution,
} from '@/api/institutions/requests'
import { INSTITUTION_PAGE_SIZE, type Institution, type InstitutionFilters } from '@/api/institutions/types'
import { invalidateInstitutionPages } from '@/api/cache/invalidation'
import { institutionKeys } from '@/api/cache/queryKeys'
import { updateCachedInstitution, updateCreatedInstitution } from '@/api/cache/updates/institutions'
import { useAuth } from '@/hooks/useAuth'

/**
 * How long a page of institutions or one institution's record is kept before it is read again
 *
 * Every user shares the table, so one user's new institution or correction reaches the others only
 * when they read again, and a day is how long that may take
 */
const INSTITUTION_STALE_TIME_MS = 24 * 60 * 60 * 1000

/**
 * Reads paginated institutions for the pickers in account creation, identity edits and the import
 * mapping steps
 */
export function useInfiniteInstitutions(
  filters: InstitutionFilters = {},
  pageSize = INSTITUTION_PAGE_SIZE,
  enabled = true,
) {
  const { accessToken } = useAuth()
  return useInfiniteQuery({
    queryKey: institutionKeys.infinite(filters as Record<string, unknown>, pageSize),
    queryFn: ({ pageParam, signal }) => fetchInstitutionsPage(filters, pageSize, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < pageSize ? undefined : allPages.length * pageSize),
    enabled: !!accessToken && enabled,
    staleTime: INSTITUTION_STALE_TIME_MS,
  })
}

/**
 * Reads one institution when its ID is available, for a picker showing a selection that is not on
 * a loaded page
 */
export function useInstitution(institutionId: string | null | undefined, enabled = true) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: institutionKeys.detail(institutionId),
    queryFn: ({ signal }) => fetchInstitution(institutionId as string, signal),
    enabled: !!accessToken && !!institutionId && enabled,
    staleTime: INSTITUTION_STALE_TIME_MS,
  })
}

/**
 * Reads the institutions with the given IDs into a lookup by ID, for a screen that names the
 * institutions its answers chose without holding the whole table
 *
 * An institution that has not arrived is absent from the map, and IDs repeated or blank are read once
 * or not at all
 */
export function useInstitutionsById(institutionIds: string[]) {
  const { accessToken } = useAuth()
  const uniqueIds = [...new Set(institutionIds.filter((id) => id !== ''))]
  const institutions = useQueries({
    queries: uniqueIds.map((institutionId) => ({
      queryKey: institutionKeys.detail(institutionId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchInstitution(institutionId, signal),
      enabled: !!accessToken,
      staleTime: INSTITUTION_STALE_TIME_MS,
    })),
    // Plain data, so the combined result keeps its reference while nothing has changed
    combine: (results) => results.flatMap((result) => (result.data ? [result.data] : [])),
  })
  return useMemo(() => new Map(institutions.map((institution) => [institution.id, institution])), [institutions])
}

/**
 * Creates institutions and keeps the cached record and pickers in sync
 */
export function useCreateInstitution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createInstitution,
    onSuccess: (newInstitution) => {
      updateCreatedInstitution(queryClient, newInstitution)
    },
    onError: () => {
      // Duplicate creates can return 409 before the existing institution is on a loaded page
      invalidateInstitutionPages(queryClient)
    },
  })
}

/**
 * Submits corrections to institutions and refreshes what shows their details
 */
export function useUpdateInstitution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateInstitution,
    onSuccess: (institution: Institution) => {
      updateCachedInstitution(queryClient, institution)
    },
  })
}
