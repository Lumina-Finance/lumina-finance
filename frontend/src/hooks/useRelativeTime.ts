import { useRelativeTimeRefresh } from '@/hooks/useRelativeTimeRefresh'
import { formatRelativeTime } from '@/utils/relativeTime'

/**
 * Words a past ISO-8601 timestamp relative to now, such as "5 minutes ago", and keeps them matching
 * the clock while the caller stays on screen. Returns null for a null timestamp
 *
 * Re-renders the caller only when the words actually change
 */
export function useRelativeTime(iso: string | null): string | null {
  useRelativeTimeRefresh(() => (iso === null ? '' : formatRelativeTime(iso)))
  return iso === null ? null : formatRelativeTime(iso)
}
