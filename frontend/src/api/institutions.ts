import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import { institutionKeys } from '@/api/queryKeys';
import type { Institution } from '@/api/accounts';

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

function createInstitution(payload: CreateInstitutionPayload) {
  return authenticatedFetch<Institution>('/institutions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

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
      // On 409 (duplicate), refetch so the existing institution appears in the dropdown
      queryClient.invalidateQueries({ queryKey: institutionKeys.list(), exact: true });
    },
  });
}
