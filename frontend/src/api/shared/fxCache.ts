import type { DefaultError, Query, QueryKey } from '@tanstack/react-query';
import type { FxStatus } from '@/api/shared/fx';

const FX_CACHEABLE_STATES = new Set(['none', 'complete']);

type FxStatusLike = Pick<FxStatus, 'missing_pairs'> & {
  state: string;
};

type FxAwareStaleTime = <
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  query: Query<TQueryFnData, TError, TData, TQueryKey>
) => number;

/**
 * Checks any response shape for an FX status that should not be cached as fresh data
 */
export function hasUncacheableFxStatus(value: unknown): boolean {
  return hasUncacheableFxStatusValue(value, new WeakSet<object>());
}

/**
 * Recursively scans JSON response data while avoiding repeated object references
 */
function hasUncacheableFxStatusValue(value: unknown, visited: WeakSet<object>): boolean {
  if (value == null) return false;

  if (Array.isArray(value)) {
    if (visited.has(value)) return false;
    visited.add(value);

    return value.some((item) => hasUncacheableFxStatusValue(item, visited));
  }

  if (!isRecord(value)) return false;
  if (visited.has(value)) return false;
  visited.add(value);

  if (isFxStatusLike(value)) return !FX_CACHEABLE_STATES.has(value.state);

  return Object.values(value).some((item) => hasUncacheableFxStatusValue(item, visited));
}

/**
 * Keeps final failed FX responses active in the UI without treating them as fresh cache entries
 */
export function getFxAwareStaleTime(staleTimeMs: number): FxAwareStaleTime {
  return <
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    query: Query<TQueryFnData, TError, TData, TQueryKey>,
  ) => (hasUncacheableFxStatus(query.state.data) ? 0 : staleTimeMs);
}

/**
 * Narrows plain JSON response objects before checking response fields
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Detects the backend FX status contract while still rejecting future non-success states
 */
function isFxStatusLike(value: Record<string, unknown>): value is FxStatusLike {
  return typeof value.state === 'string' && Array.isArray(value.missing_pairs);
}
