import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  removeMerchantCaches,
  updateMerchantCreateCaches,
  updateMerchantUpdateCaches,
} from '@/api/cache/updates/merchants';
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
 * Reads merchant detail records for a list of ids, mapped in the same order as the input, so
 * results can be paired with the ids by index
 */
export function useMerchantDetails(merchantIds: string[]) {
  const { accessToken } = useAuth();
  return useQueries({
    queries: merchantIds.map((merchantId) => ({
      queryKey: merchantKeys.detail(merchantId),
      queryFn: () => fetchMerchant(merchantId),
      enabled: !!accessToken,
      staleTime: Infinity,
      gcTime: Infinity,
    })),
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

/**
 * Invalidates every cached merchant list and detail so the next read refetches them
 */
export function useRefreshMerchants() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: merchantKeys.all, exact: false }),
    [queryClient],
  );
}
