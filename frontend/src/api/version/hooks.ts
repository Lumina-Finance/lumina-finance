import { useQuery } from '@tanstack/react-query';
import { fetchAppVersion } from '@/api/version/requests';
import { appVersionKeys } from '@/api/cache/queryKeys';

/**
 * Polls the backend version endpoint for app update notices
 */
export function useAppVersion() {
  return useQuery({
    queryKey: appVersionKeys.version(),
    queryFn: fetchAppVersion,
    staleTime: 15 * 60 * 1000,
    gcTime: Infinity,
  });
}
