import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch } from '@/api/client';
import type { Institution } from '@/api/accounts';

export function useInstitutions() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['institutions'],
    queryFn: () => authenticatedFetch<Institution[]>('/institutions'),
    enabled: !!accessToken,
    // Institutions are near-static reference data
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
