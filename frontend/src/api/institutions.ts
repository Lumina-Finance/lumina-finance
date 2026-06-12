import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { institutionKeys } from '@/api/queryKeys';
import type { Institution } from '@/api/accounts';

/**
 * Reads institutions available for account creation and account identity edits
 */
export function useInstitutions() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: institutionKeys.list(),
    queryFn: () => authenticatedFetch<Institution[]>('/institutions'),
    enabled: !!accessToken,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: Infinity,
  });
}

interface CreateInstitutionPayload {
  name: string;
  country_code: string;
  website: string;
}

/**
 * Creates an institution record from the account creation flow
 */
function createInstitution(payload: CreateInstitutionPayload) {
  return authenticatedFetch<Institution>('/institutions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Creates institutions and keeps the cached selector list in sync
 */
export function useCreateInstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createInstitution,
    onSuccess: (newInstitution) => {
      queryClient.setQueryData<Institution[]>(institutionKeys.list(), (old = []) => [
        ...old,
        newInstitution,
      ]);
    },
    onError: () => {
      // Duplicate creates can return 409 before the existing institution is present locally
      queryClient.invalidateQueries({ queryKey: institutionKeys.list(), exact: true });
    },
  });
}
