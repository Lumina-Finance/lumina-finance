import { authenticatedFetch } from '@/api/client';
import type {
  CreateInstitutionPayload,
  Institution,
  UpdateInstitutionRequest,
} from '@/api/institutions/types';

/**
 * Fetches institutions available for account creation and account identity edits
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchInstitutions(signal?: AbortSignal) {
  return authenticatedFetch<Institution[]>('/institutions', { signal });
}

/**
 * Creates an institution record from the account creation flow
 */
export function createInstitution(payload: CreateInstitutionPayload) {
  return authenticatedFetch<Institution>('/institutions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Submits a correction to an institution every user on the instance shares
 */
export function updateInstitution({ institutionId, payload }: UpdateInstitutionRequest) {
  return authenticatedFetch<Institution>(`/institutions/${institutionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
