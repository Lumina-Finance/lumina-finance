import type { QueryClient } from '@tanstack/react-query';
import { dashboardKeys } from '@/api/cache/queryKeys';
import type { CreditUtilizationResponse } from '@/api/dashboard/types';

/**
 * Stores the credit widget data returned by saving which accounts count, so the widget shows the new
 * figure without waiting for a refetch
 */
export function updateCreditUtilizationCache(queryClient: QueryClient, utilization: CreditUtilizationResponse) {
  queryClient.setQueryData(dashboardKeys.creditUtilization(), utilization);
}
