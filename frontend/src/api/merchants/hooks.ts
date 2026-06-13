import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  removeMerchantCaches,
  updateMerchantCreateCaches,
  updateMerchantUpdateCaches,
} from '@/api/cache/merchants';
import {
  createMerchant,
  deleteMerchant,
  fetchMerchant,
  fetchMerchantsPage,
  mergeMerchant,
  updateMerchant,
} from '@/api/merchants/requests';
import type { MerchantFilters } from '@/api/merchants/types';
import { merchantKeys } from '@/api/cache/queryKeys';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads a merchant detail record when a merchant ID is available
 */
export function useMerchant(merchantId: string | null | undefined, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: merchantKeys.detail(merchantId),
    queryFn: () => fetchMerchant(merchantId),
    enabled: !!accessToken && !!merchantId && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Reads paginated merchants for settings and transaction merchant selectors
 */
export function useInfiniteMerchants(
  filters: MerchantFilters = {},
  pageSize = 20,
  enabled = true,
) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: merchantKeys.infinite(filters as Record<string, unknown>, pageSize),
    queryFn: ({ pageParam }) => fetchMerchantsPage(filters, pageSize, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length * pageSize,
    enabled: !!accessToken && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Creates merchants and writes them into matching lookup caches
 */
export function useCreateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMerchant,
    onSuccess: (merchant) => {
      updateMerchantCreateCaches(queryClient, merchant);
    },
  });
}

/**
 * Updates merchants and refreshes lookup caches or dependent merchant usage data
 */
export function useUpdateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMerchant,
    onSuccess: (merchant, { payload }) => {
      updateMerchantUpdateCaches(queryClient, merchant, payload);
    },
  });
}

/**
 * Deletes merchants and clears dependent merchant usage data
 */
export function useDeleteMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMerchant,
    onSuccess: (_, merchantId) => {
      removeMerchantCaches(queryClient, merchantId);
    },
  });
}

/**
 * Merges merchants and clears dependent merchant usage data
 */
export function useMergeMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mergeMerchant,
    onSuccess: (_, { merchantId }) => {
      removeMerchantCaches(queryClient, merchantId);
    },
  });
}
