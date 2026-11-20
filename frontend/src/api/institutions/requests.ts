import { authenticatedFetch } from '@/api/client'
import { buildQueryString, type QueryStringValue } from '@/api/utils/queryString'
import {
  INSTITUTION_PAGE_SIZE,
  type CreateInstitutionPayload,
  type Institution,
  type InstitutionFilters,
  type UpdateInstitutionRequest,
} from '@/api/institutions/types'

/**
 * Fetches one filtered page of institutions for the pickers in account creation, identity edits and
 * the import mapping steps
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInstitutionsPage(
  filters: InstitutionFilters = {},
  pageSize = INSTITUTION_PAGE_SIZE,
  offset = 0,
  signal?: AbortSignal,
) {
  return authenticatedFetch<Institution[]>(
    '/institutions' +
      buildQueryString({
        ...(filters as Record<string, QueryStringValue>),
        limit: pageSize,
        offset,
      }),
    { signal },
  )
}

/**
 * Fetches one institution by ID, for a picker showing a selection that is not on a loaded page
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInstitution(institutionId: string, signal?: AbortSignal) {
  return authenticatedFetch<Institution>(`/institutions/${institutionId}`, { signal })
}

/**
 * Creates an institution record from the account creation flow
 */
export function createInstitution(payload: CreateInstitutionPayload) {
  return authenticatedFetch<Institution>('/institutions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Submits a correction to an institution every user on the instance shares
 */
export function updateInstitution({ institutionId, payload }: UpdateInstitutionRequest) {
  return authenticatedFetch<Institution>(`/institutions/${institutionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
