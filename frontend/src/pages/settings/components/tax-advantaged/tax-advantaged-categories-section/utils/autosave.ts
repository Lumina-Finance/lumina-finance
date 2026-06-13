import type { AutosaveNotice } from '@/pages/settings/components/tax-advantaged/types'

export function autosaveNoticeColor(status: AutosaveNotice['status']) {
  if (status === 'error') return 'var(--app-negative)'
  if (status === 'saved') return 'var(--app-positive)'
  return 'var(--app-accent)'
}
