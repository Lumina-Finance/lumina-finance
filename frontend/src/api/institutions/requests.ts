import { authenticatedFetch } from '@/api/client';
import type {
  CreateInstitutionPayload,
  Institution,
  UpdateInstitutionRequest,
} from '@/api/institutions/types';

/**
 * Fetches institutions available for account creation and account identity edits
 */
export function fetchInstitutions() {
  return authenticatedFetch<Institution[]>('/institutions');
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
