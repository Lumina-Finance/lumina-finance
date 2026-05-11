import type { AutosaveNotice } from '@/settings/components/tax-advantaged/taxAdvantagedTypes'

export function autosaveNoticeColor(status: AutosaveNotice['status']) {
  if (status === 'error') return 'var(--app-negative)'
  if (status === 'saved') return 'var(--app-positive)'
  return 'var(--app-accent)'
}
