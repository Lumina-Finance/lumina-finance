import type { AutosaveNotice } from '@/pages/settings/components/tax-advantaged/types'

/**
 * Colour for the autosave status icon, matching negative, positive or accent depending on
 * whether the last save failed, succeeded, or is still in progress
 */
export function autosaveNoticeColor(status: AutosaveNotice['status']) {
  if (status === 'error') return 'var(--app-negative)'
  if (status === 'saved') return 'var(--app-positive)'
  return 'var(--app-accent)'
}
