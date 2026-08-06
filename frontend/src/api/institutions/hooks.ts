import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createInstitution,
  fetchInstitutions,
  updateInstitution,
} from '@/api/institutions/requests';
import type { Institution } from '@/api/institutions/types';
import { institutionKeys } from '@/api/cache/queryKeys';
import { updateCachedInstitution } from '@/api/cache/updates/institutions';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads institutions available for account creation and account identity edits
 */
export function useInstitutions() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: institutionKeys.list(),
    queryFn: fetchInstitutions,
    enabled: !!accessToken,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: Infinity,
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

/**
 * Submits corrections to institutions and refreshes what shows their details
 */
export function useUpdateInstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateInstitution,
    onSuccess: (institution) => {
      updateCachedInstitution(queryClient, institution);
    },
  });
}
